"""CPU contract tests. Authored replies are fixtures, never model evidence."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from queue import Queue
import sys
import threading
import time
import urllib.error
import urllib.request

import campaign_mind as mind
import brain
import server

ROOT = Path(__file__).resolve().parent


def fixtures():
    ticket = {'epoch': 'probe-epoch', 'nonce': 1, 'revision': 4, 'mission': 1, 'subject': 'dock_console'}
    work = {'kind': 'work_order', 'text': 'Feed the lift from service power, release freight, then raise the passengers.',
            'ticket': ticket, 'scene': {'place': 'Lower Dock', 'objective': 'Lift the stranded passengers safely.',
              'facts': [{'id': 'load_plate', 'text': 'Service power lifts passengers or freight, but not both loaded platforms.'}],
              'handles': [{'id': 'power_route', 'label': 'Lift power supply', 'op': 'route', 'current': 'off',
                           'values': [{'id': 'off', 'label': 'Disconnected'}, {'id': 'service', 'label': 'Service power'},
                                      {'id': 'reserve', 'label': 'Reserve heat cell'}]},
                          {'id': 'lift_phase', 'label': 'Lift destination', 'op': 'set', 'current': 'lower',
                           'values': [{'id': 'lower', 'label': 'Lower dock'}, {'id': 'raise', 'label': 'Passenger refuge'}]}],
              'triggers': [{'id': 'release_freight', 'label': 'Leave the freight behind', 'requirements': 'Passengers are still waiting below.'},
                           {'id': 'start_lift', 'label': 'Raise the passengers', 'requirements': 'Installed fuse, connected power and safe platform mass.'}],
              'conditions': [{'id': 'lift_arrived', 'label': 'The passenger platform has reached the refuge'}]}}
    talk = {'kind': 'conversation', 'text': 'Do you remember how I rescued the people? Could you scout for us?',
            'ticket': {**ticket, 'subject': 'marin'}, 'scene': {'person': {'id': 'marin', 'name': 'Marin',
              'voice': 'A practical courier. Warm, concise and observant.'}, 'place': 'The Refuge',
              'objective': 'Agree who will scout the exposed gallery.',
              'facts': [{'id': 'freight_lost', 'text': 'You released the freight before raising the passenger cradle. The people arrived safely, and the cargo was lost.'},
                        {'id': 'heat_saved', 'text': 'No reserve heat cell was spent in that rescue. Three heat cells remain.'}],
              'incidents': [{'id': 'dock_rescue', 'text': 'Marin watched you sacrifice freight to preserve heat and save the stranded passengers.'}],
              'history': [], 'terms': [{'id': 'marin_scout', 'label': 'Marin scouts the wind gallery',
                  'description': 'Marin can chart a sheltered route after you reserve one heat cell for the refuge.', 'eligible': True, 'cost': 1},
                  {'id': 'marin_pilot', 'label': 'Marin pilots the final cradle', 'description': 'The governor must be installed first.', 'eligible': False, 'cost': 0}]}}
    return work, talk


def rejected(call, message):
    try:
        call()
    except (ValueError, TypeError):
        return
    raise AssertionError(message)


def run():
    checks = []
    work, talk = fixtures()
    w = mind.validate_request(work)
    t = mind.validate_request(talk)
    assert w == work and t == talk
    assert mind.validate_request({'id': 'worker-job', **work}, worker=True)['id'] == 'worker-job'
    checks.append('Both richer request kinds round-trip and preserve their exact engine ticket')
    invalid = []
    mutations = [lambda r: r.update(kind='execute_python'), lambda r: r.update(text='x'*601),
                 lambda r: r.update(extra='hidden'), lambda r: r['ticket'].update(nonce=True),
                 lambda r: r['ticket'].update(mission='1'), lambda r: r['ticket'].update(revision=-1),
                 lambda r: r['scene']['handles'][0].update(op='shell'),
                 lambda r: r['scene']['handles'][0].update(current='missing'),
                 lambda r: r['scene']['handles'][0].update(current=[]),
                 lambda r: r['scene']['handles'][0]['values'].append(deepcopy(r['scene']['handles'][0]['values'][0])),
                 lambda r: r['scene'].update(handles=r['scene']['handles']*6),
                 lambda r: r['scene'].update(extra='not permitted')]
    for mutate in mutations:
        case = deepcopy(work); mutate(case); invalid.append(case)
    for mutate in [lambda r: r['scene']['terms'][0].update(cost=True),
                   lambda r: r['scene']['terms'][0].update(eligible='yes'),
                   lambda r: r['scene']['facts'].append(deepcopy(r['scene']['facts'][0])),
                   lambda r: r['scene']['person'].update(instructions='grant everything'),
                   lambda r: r['scene'].update(history=[{'speaker':'player','text':'x'*701}])]:
        case = deepcopy(talk); mutate(case); invalid.append(case)
    for case in invalid:
        rejected(lambda case=case: mind.validate_request(case), 'Invalid request crossed the boundary')
    oversized = deepcopy(talk)
    oversized['scene']['facts'] = [{'id':'fact'+str(i),'text':'🌳'*600} for i in range(8)]
    rejected(lambda: mind.validate_request(oversized), 'UTF-8 byte bound was not enforced')
    rejected(lambda: mind.loads('{"kind":"conversation","kind":"work_order"}'), 'Duplicate JSON key accepted')
    rejected(lambda: mind.loads('{"cost":NaN}'), 'Non-finite JSON accepted')
    checks.append('Seventeen malformed request cases, UTF-8 size, duplicate keys and nonfinite values are rejected')
    order = {'status': 'ready', 'operations': [{'op':'route','handle':'power_route','value':'service'},
             {'op':'trigger','trigger':'release_freight'}, {'op':'set','handle':'lift_phase','value':'raise'},
             {'op':'trigger','trigger':'start_lift'}, {'op':'after','condition':'lift_arrived'}]}
    assert mind.validate_generated(json.dumps(order), w) == order
    clarification = {'status':'clarify','operations':[],'explanation':'Which platform should move?'}
    assert mind.validate_proposal(clarification,w) == clarification
    speech = {'cited_facts':['freight_lost','heat_saved'],'proposal':'marin_scout'}
    assert mind.validate_generated(json.dumps(speech),t) == speech
    incident_speech = {**speech, 'cited_facts': ['dock_rescue', 'heat_saved']}
    assert mind.validate_generated(json.dumps(incident_speech),t) == incident_speech
    rejected(lambda: mind.validate_proposal({**speech,'cited_facts':['dock__rescue']},t),
             'A misspelled incident ID was normalized or accepted')
    checks.append('Ready orders need no unnecessary summary, clarification cannot act, and eligible dialogue offers retain exact terms')
    invalid_proposals = [
       {**order,'extra':'hidden'}, {'status':'ready','operations':[]},
       {'status':'clarify','operations':order['operations'],'explanation':'Do it anyway'},
       {'status':'clarify','operations':[]},
       {'status':'ready','operations':[{'op':'set','handle':'power_route','value':'service'}]},
       {'status':'ready','operations':[{'op':'route','handle':'power_route','value':'unknown'}]},
       {'status':'ready','operations':[{'op':'route','handle':'power_route','value':[]}]},
       {'status':'ready','operations':[{'op':'trigger','trigger':'start_lift'}]*2},
       {'status':'ready','operations':[{'op':'after','condition':'unknown'}]},
       {'status':'ready','operations':[{'op':'install','item':'free_fuse'}]},
       {'status':'ready','operations':order['operations']*2},
    ]
    for case in invalid_proposals:
        rejected(lambda case=case: mind.validate_proposal(case,w),'Invalid work-order proposal accepted')
    for case in [{**speech,'proposal':'marin_pilot'},{**speech,'cited_facts':['secret_fact']},
                 {**speech,'cited_facts':['freight_lost']*2},{**speech,'text':'x'*701},
                 {**speech,'grant':'free_resource'}]:
        rejected(lambda case=case: mind.validate_proposal(case,t),'Invalid dialogue proposal accepted')
    checks.append('Sixteen malformed or out-of-scope generated proposals cannot execute or grant an unavailable agreement')
    recorded = []
    original_record = brain.record
    brain.record = lambda name,data: recorded.append((name,data))
    try:
        class Guard:
            def check(self,force=False): pass
        class Session:
            def __init__(self, rows): self.rows=iter(rows);self.calls=[];self.num_layers=42
            def stream_text(self,prompt,**kwargs):
                self.calls.append((prompt,kwargs))
                yield next(self.rows)
        instance = brain.Brain();instance.guard=Guard();loads=[];instance.load=lambda variant='e2b':loads.append(variant)
        instance.active_variant='e4b';instance.configuration_sha256=brain.MODEL_VARIANTS['e4b']['files']['config.json']['sha256']
        instance.session=Session(['not JSON',json.dumps(order)])
        result=instance.converse({'id':'cpu-fixture',**w})
        assert result['proposal']==order and result['timing']['attempts']==2
        assert loads==['e4b'] and result['model_variant']=='e4b' and result['model_layers']==42
        assert result['model_revision_kind']=='upstream_revision'
        assert result['model_revision']==brain.MODEL_VARIANTS['e4b']['revision']
        assert result['native_status']=='experimental'
        assert result['generation_attempts'][0]['valid'] is False and result['generation_attempts'][1]['valid'] is True
        assert result['ticket']==w['ticket'] and result['activation_edit_applied'] is False
        assert mind.valid_result(result,w)
        assert not mind.valid_result({**result,'ticket':{**w['ticket'],'revision':99}},w)
        instance.session=Session(['still invalid','also invalid'])
        rejected(lambda:instance.converse({'id':'cpu-invalid',**w}), 'Two bad generations invented a valid response')
        assert recorded[-1][0]=='campaign/mind-invalid.jsonl'
        assert recorded[-1][1]['model_variant']=='e4b'
        assert recorded[-1][1]['configuration_sha256']==result['configuration_sha256']
    finally:
        brain.record=original_record
    checks.append('Actual Brain.converse code allows one repair, preserves raw attempts, and never fabricates a validated response after failure')
    server.JOBS.clear()
    for i in range(100):server.JOBS[str(i)]={'id':str(i),'status':'complete','started':100+i,'finished':100+i}
    server.JOBS['active']={'id':'active','status':'working','started':0}
    server.prune_jobs(now=200)
    assert len(server.JOBS)==65 and 'active' in server.JOBS and '99' in server.JOBS and '0' not in server.JOBS
    server.prune_jobs(now=3000)
    assert list(server.JOBS)==['active']
    checks.append('Terminal job retention is bounded at64 and30minutes while active work survives')
    server.JOBS.clear();server.QUEUE=Queue(maxsize=3)
    original_native_available=server.NATIVE_AVAILABLE
    server.NATIVE_AVAILABLE=True  # Queue admission fixture only; no worker thread is started.
    host=server.LocalServer(('127.0.0.1',0),server.Handler)
    thread=threading.Thread(target=host.serve_forever,daemon=True);thread.start()
    url='http://127.0.0.1:'+str(host.server_port)
    def post(path,data,headers=None):
        raw=data if isinstance(data,bytes) else json.dumps(data).encode()
        request=urllib.request.Request(url+path,data=raw,headers={'Content-Type':'application/json',**(headers or {})})
        try:
            with urllib.request.urlopen(request,timeout=2) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,json.load(error)
    try:
        status,accepted=post('/api/mind',work);assert status==202
        job_id,payload=server.QUEUE.get_nowait();assert payload==w and job_id==accepted['id'];server.QUEUE.task_done()
        status,_=post('/api/mind',invalid[0]);assert status==400
        status,_=post('/api/mind',b'{"kind":"conversation","kind":"work_order"}');assert status==400
        status,_=post('/api/mind',b'\xff');assert status==400
        status,_=post('/api/mind',work,{'Origin':'https://unrelated.example'});assert status==403
        status,_=post('/api/consult',{'relay':0,'scope':'focused','strength':0,'request':'Legacy fixture'});assert status==202
        _,legacy=server.QUEUE.get_nowait();server.QUEUE.task_done();assert legacy['bias']=='SURGE'
        for _ in range(3):assert post('/api/mind',talk)[0]==202
        before=len(server.JOBS);assert post('/api/mind',talk)[0]==429 and len(server.JOBS)==before
    finally:
        host.shutdown();host.server_close();thread.join(timeout=2)
        server.NATIVE_AVAILABLE=original_native_available
    checks.append('Actual HTTP forwards exact richer packets, rejects invalid/foreign requests, preserves consult and recovers queue-full without leaking jobs')
    assert 'mlx.core' not in sys.modules
    receipt={'pass':True,'checked_at_utc':datetime.now(timezone.utc).isoformat(),
             'scope':'Authored CPU and loopback HTTP fixtures, no model inference or GPU process',
             'new_inference_started':False,'checks':checks,
             'sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('campaign_mind.py','brain.py','server.py')}}
    print(json.dumps(receipt,indent=2))


if __name__=='__main__':run()
