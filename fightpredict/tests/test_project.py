"""Contract, leakage, numerical and HTTP tests; no extra testing dependency."""
import copy
import json
from pathlib import Path
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import handler_for
from dataset import ROOT, name_key
from features import FEATURE_NAMES, feature_vector
from inference import Predictor

class ProjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.predictor = Predictor()
        cls.a = next(f for f in cls.predictor.catalog if f['name'] == 'Merab Dvalishvili')
        cls.b = next(f for f in cls.predictor.catalog if f['name'] == 'Umar Nurmagomedov')
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(cls.predictor))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
        cls.url = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(timeout=5)

    def request(self, route, payload=None, content_type='application/json'):
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(self.url+route, data=data, headers={'Content-Type':content_type})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error: return error.code, error.read()

    def test_http_pages_and_actual_prediction(self):
        for path in ['/', '/app.js', '/styles.css', '/api/health', '/api/fighters', '/api/schema', '/api/metrics', '/reports/figures/calibration.png']:
            status, body = self.request(path); self.assertEqual(status,200,path); self.assertGreater(len(body),10)
        status, blob = self.request('/api/predict', {'fighter_a':self.a,'fighter_b':self.b})
        self.assertEqual(status,200); response=json.loads(blob)
        self.assertAlmostEqual(response['probability_a'],self.predictor.predict(self.a,self.b)['probability_a'],places=12)

    def test_swap_symmetry(self):
        ab=self.predictor.predict(self.a,self.b); ba=self.predictor.predict(self.b,self.a)
        self.assertAlmostEqual(ab['probability_a']+ba['probability_a'],1,places=12)
        self.assertGreater(len(ab['sensitivity']),0)

    def test_identical_custom_stats_are_fifty_fifty(self):
        a=copy.deepcopy(self.a); b=copy.deepcopy(self.a); a['id']='';b['id']='';b['name']='Other'
        self.assertAlmostEqual(self.predictor.predict(a,b)['probability_a'],.5,places=12)

    def test_partial_missing_fields_and_symmetry(self):
        a=copy.deepcopy(self.a); a['reach_cm']=None; a['striking_accuracy']=None
        p=self.predictor.predict(a,self.b)
        self.assertTrue(np.isfinite(p['probability_a']));self.assertTrue(p['missing']);self.assertTrue(p['warnings'])
        self.assertAlmostEqual(p['probability_a']+self.predictor.predict(self.b,a)['probability_a'],1,places=12)

    def test_invalid_input_is_rejected(self):
        for field,value in [('age',-5),('height_cm',300),('striking_accuracy',110),('wins',1.5),('reach_cm',float('nan')),('wins',True)]:
            a=copy.deepcopy(self.a);a[field]=value
            with self.assertRaises(ValueError,msg=field):self.predictor.predict(a,self.b)
        with self.assertRaises(ValueError):self.predictor.predict(self.a,self.a)
        b=copy.deepcopy(self.b);b['gender']='FEMALE'
        with self.assertRaises(ValueError):self.predictor.predict(self.a,b)

    def test_bad_api_request_and_no_path_escape(self):
        self.assertEqual(self.request('/api/predict',{'fighter_a':self.a})[0],400)
        self.assertEqual(self.request('/api/predict',{'fighter_a':self.a,'fighter_b':self.b},'text/plain')[0],415)
        self.assertEqual(self.request('/../models/fightpredict.joblib')[0],404)
        self.assertEqual(self.request('/api/unknown')[0],404)

    def test_manual_features_match_training_contract(self):
        x=feature_vector(self.a,self.b); swapped=feature_vector(self.b,self.a)
        np.testing.assert_allclose(x,-swapped,equal_nan=True)
        self.assertEqual(len(x),len(FEATURE_NAMES))

    def test_saved_model_reproduces_report(self):
        processed=pd.read_csv(ROOT/'data'/'processed_bouts.csv')
        test=processed[processed.date >= '2025-01-01']
        predictions=pd.read_csv(ROOT/'reports'/'test_predictions.csv')
        self.assertEqual(len(test),len(predictions))
        np.testing.assert_allclose(self.predictor.probability(test[FEATURE_NAMES]),predictions.probability_a,atol=1e-12)

    def test_chronological_split_boundaries(self):
        splits=self.predictor.metrics['splits']; names=['train','validation','calibration','test']
        for left,right in zip(names,names[1:]):self.assertLess(splits[left]['end'],splits[right]['start'])
        self.assertEqual(sum(v['bouts'] for v in splits.values()),self.predictor.metrics['audit']['usable_bouts'])

    def test_record_features_use_only_earlier_days(self):
        processed=pd.read_csv(ROOT/'data'/'processed_bouts.csv')
        raw=pd.read_csv(ROOT/'data'/'raw'/'ufc_fights.csv')
        aliases={name_key(r['source_name']):name_key(r['history_name']) for r in self.predictor.metrics['audit']['name_aliases']}
        def canonical(name):
            key=name_key(name);seen=set()
            while key in aliases and key not in seen:seen.add(key);key=aliases[key]
            return key
        raw['key']=raw.apply(lambda r:'|'.join(sorted([canonical(r.f1_name),canonical(r.f2_name)])),axis=1)
        raw=raw.drop_duplicates(['date','key'])
        # Includes an alias case; outcomes on the target day are intentionally excluded.
        for target in ['Merab Dvalishvili','Bobby Green']:
            row=processed[(processed.fighter_a==target)|(processed.fighter_b==target)].iloc[-1]
            previous=raw[raw.date < row.date]
            def counts(name):
                key=canonical(name); wins=losses=0
                for bout in previous.itertuples():
                    for n,result in [(bout.f1_name,bout.f1_result),(bout.f2_name,bout.f2_result)]:
                        if canonical(n)==key:
                            wins += result=='W'; losses += result=='L'
                return wins,losses
            aw,al=counts(row.fighter_a);bw,bl=counts(row.fighter_b)
            self.assertEqual(row.wins_diff,aw-bw);self.assertEqual(row.losses_diff,al-bl)

if __name__ == '__main__': unittest.main(verbosity=2)
