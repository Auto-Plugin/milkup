"""Pure synthetic observations only; no Windows, product, network or file deletion."""
import copy
import unittest
from cleanup_observations import ObservationError, U64, validate_finished_cleanup_observations as check, validate_cleanup_observation_events, strict_json


def sample():
    value = {'phase':'finished','productPid':100,'requestId':'synthetic-r1','successful':True,
             'cleanupUncertain':False,'privateTreeRemoved':True,'ipcThreadsCompleted':True,
             'ownedJobCreated':True,'profileCreated':True,'profileDeleted':True,
             'cancelled':False,'deadlineExpired':False,'jobActiveAfterStop':0,
             'privateTreeCleanup':{'attempts':1,'elapsedMs':5000,'finalOsError':None,
                 'terminalPhase':'complete','absenceChecked':True,'absent':True,'failedAttempts':[]},
             'cleanupTimeline':{'jobStopFinishedMs':100,'ipcJoinsFinishedMs':1800,
                 'pinsReleasedMs':1800,'profileDeleteFinishedMs':2000,'treeDeleteFinishedMs':7000},
             'ipcThreadCleanup':[]}
    for stream, phase, completion in [('stdout','trailing-byte','eof'),('stdin','written-event','written'),('stderr','stderr-read','eof')]:
        value['ipcThreadCleanup'].append({'stream':stream,'elapsedMs':500,'cancelRequested':False,
            'cancelCallSucceeded':None,'cancelWin32Error':None,'finished':True,'panicked':False,
            'progressAtJoin':{'phase':phase,'completion':'pending'},'progressAtCancel':None,
            'progressAtEnd':{'phase':phase,'completion':completion}})
    return value


def failed(value):
    value['successful']=False;value['cleanupUncertain']=True
    return value


class ObservationTests(unittest.TestCase):
    def test_complete_observations_do_not_impose_retry_or_join_wallclock_caps(self):
        value=sample();result=check(value)
        self.assertTrue(result['observationEvidenceVerified'])
        self.assertTrue(result['treeAbsenceCompletionObserved'])
        self.assertFalse(result['nativeAcceptanceEvaluated'])
        self.assertTrue(result['requiresOriginalAuditLedger'])
        value['privateTreeCleanup']['elapsedMs']=U64
        for key in value['cleanupTimeline']:value['cleanupTimeline'][key]=U64
        for row in value['ipcThreadCleanup']:row['elapsedMs']=U64
        check(value)

    def test_admitted_early_cancel_has_no_job_profile_or_ipc_but_deletes_root(self):
        value=sample();value.update(successful=False,cancelled=True,ownedJobCreated=False,
            profileCreated=False,profileDeleted=False,ipcThreadCleanup=[],jobActiveAfterStop=None)
        value['cleanupTimeline']={'jobStopFinishedMs':None,'ipcJoinsFinishedMs':0,
            'pinsReleasedMs':None,'profileDeleteFinishedMs':None,'treeDeleteFinishedMs':5}
        result=check(value)
        self.assertEqual(result['ipcThreadsObserved'],0)
        self.assertTrue(result['treeAbsenceCompletionObserved'])

    def test_uncreated_nullable_record_does_not_fabricate_completion(self):
        value=sample();value.update(successful=False,cancelled=True,ownedJobCreated=False,
            profileCreated=False,profileDeleted=False,ipcThreadCleanup=[],jobActiveAfterStop=None,
            privateTreeCleanup=None,cleanupTimeline=None)
        result=check(value)
        self.assertFalse(result['timelinePresent'])
        self.assertFalse(result['treeAbsenceCompletionObserved'])
        self.assertFalse(result['nativeAcceptanceEvaluated'])

    def test_profile_initialization_failure_keeps_partial_creation_observations(self):
        value=failed(sample());value.update(ownedJobCreated=False,profileDeleted=False,
            ipcThreadCleanup=[],jobActiveAfterStop=None)
        value['cleanupTimeline']={'jobStopFinishedMs':None,'ipcJoinsFinishedMs':0,
            'pinsReleasedMs':None,'profileDeleteFinishedMs':3,'treeDeleteFinishedMs':8}
        check(value)

    def test_job_stop_failure_skips_tree_and_profile_deletion(self):
        value=failed(sample());value.update(privateTreeCleanup=None,privateTreeRemoved=False,
            profileDeleted=False,jobActiveAfterStop=None)
        value['cleanupTimeline'].update(profileDeleteFinishedMs=None,treeDeleteFinishedMs=None)
        result=check(value)
        self.assertFalse(result['privateTreeObservationPresent'])

    def test_progress_pending_does_not_mean_thread_running_or_join_success(self):
        for finished, panicked, completion in [(True,True,'pending'),(False,False,'eof')]:
            value=failed(sample());value['ipcThreadsCompleted']=False
            row=value['ipcThreadCleanup'][0];row.update(finished=finished,panicked=panicked)
            row['progressAtEnd']['completion']=completion
            check(value)

    def test_cancelled_io_can_join_but_cleanup_failure_must_remain(self):
        value=failed(sample());row=value['ipcThreadCleanup'][0]
        row.update(cancelRequested=True,cancelCallSucceeded=True,
            progressAtCancel={'phase':'trailing-byte','completion':'pending'})
        row['progressAtEnd']['completion']='read-error'
        check(value)  # ipcThreadsCompleted remains true, not successful I/O.
        value['cleanupUncertain']=False
        with self.assertRaises(ObservationError):check(value)

    def test_tree_retry_success_and_non_os_absence_failures_keep_exact_meaning(self):
        value=sample();value['privateTreeCleanup'].update(attempts=3,failedAttempts=[[1,32],[2,33]])
        check(value)
        for absent in (False,None):
            value=failed(sample());value['privateTreeRemoved']=False
            value['privateTreeCleanup'].update(terminalPhase='absence-check',absent=absent,finalOsError=None)
            result=check(value)
            self.assertFalse(result['treeAbsenceCompletionObserved'])
            self.assertFalse(result['nullOsErrorUsedAsSuccessProof'])
        value=failed(sample());value['privateTreeRemoved']=False
        value['privateTreeCleanup'].update(terminalPhase='remove',absenceChecked=False,absent=None,
            finalOsError=None,failedAttempts=[[1,None]])
        check(value)

    def test_nullable_keys_unknown_keys_and_numeric_types_are_strict(self):
        changes=[lambda v:v['privateTreeCleanup'].pop('finalOsError'),
                 lambda v:v['privateTreeCleanup'].update(path='private'),
                 lambda v:v['cleanupTimeline'].pop('pinsReleasedMs'),
                 lambda v:v['ipcThreadCleanup'][0].pop('progressAtCancel'),
                 lambda v:v['ipcThreadCleanup'][0]['progressAtEnd'].update(source='private'),
                 lambda v:v['privateTreeCleanup'].update(attempts=True),
                 lambda v:v['privateTreeCleanup'].update(attempts=32),
                 lambda v:v['privateTreeCleanup'].update(finalOsError=1<<31),
                 lambda v:v['cleanupTimeline'].update(ipcJoinsFinishedMs=U64+1),
                 lambda v:v['ipcThreadCleanup'][0].update(cancelWin32Error=True),
                 lambda v:v['ipcThreadCleanup'][0]['progressAtEnd'].update(completion='unknown')]
        for change in changes:
            value=sample();change(value)
            with self.assertRaises(ObservationError):check(value)

    def test_fabricated_attempts_absence_timeline_and_cancellation_are_rejected(self):
        changes=[lambda v:v['privateTreeCleanup'].update(attempts=3,failedAttempts=[[1,32],[3,33]]),
                 lambda v:v['privateTreeCleanup'].update(attempts=2,failedAttempts=[[1,5]]),
                 lambda v:v['privateTreeCleanup'].update(absent=False),
                 lambda v:v['privateTreeCleanup'].update(terminalPhase='absence-check',absent=False,finalOsError=5),
                 lambda v:v['cleanupTimeline'].update(pinsReleasedMs=1),
                 lambda v:v['ipcThreadCleanup'][0].update(progressAtCancel={'phase':'trailing-byte','completion':'pending'}),
                 lambda v:v['ipcThreadCleanup'][0].update(progressAtEnd=None),
                 lambda v:v['ipcThreadCleanup'][0].update(finished=False,panicked=True)]
        for change in changes:
            value=sample();change(value)
            with self.assertRaises(ObservationError):check(value)

    def test_every_finished_is_checked_and_failures_do_not_mutate_input(self):
        one=sample();two=copy.deepcopy(one);two['requestId']='synthetic-r2'
        two['privateTreeCleanup']['finalOsError']=5
        original=copy.deepcopy([one,two])
        result=validate_cleanup_observation_events([one,two])
        self.assertEqual(result['finishedRecordsChecked'],2)
        self.assertFalse(result['observationEvidenceVerified'])
        self.assertTrue(result['records'][0]['observationEvidenceVerified'])
        self.assertFalse(result['records'][1]['observationEvidenceVerified'])
        self.assertEqual([one,two],original)
        self.assertFalse(result['nativeAcceptanceEvaluated'])

    def test_json_duplicate_keys_and_nonfinite_numbers_are_rejected(self):
        for value in (b'{"x":1,"x":2}',b'{"x":NaN}',b'{"x":Infinity}'):
            with self.assertRaises(ObservationError):strict_json(value)


if __name__=='__main__':
    unittest.main(verbosity=2)
