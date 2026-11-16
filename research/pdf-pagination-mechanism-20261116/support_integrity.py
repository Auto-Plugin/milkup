"""Prove the reviewed URI-report delta without changing the original receipt."""
import hashlib,pathlib,subprocess,tempfile
HERE=pathlib.Path(__file__).resolve().parent
REL='research/pdf-pagination-mechanism-20261116/support/pagination_audit.py'
BEFORE='c1f6a2006521b3503c88869cec679bbad4d53489d4320e2021a90c380234a486'
AFTER='b826c8e9b18f92d15dc96591f651b14fac04b1e6346bc883708e7a0d6cd68e90'
PATCH='122a527f4835e89569eb6f0ee89c11f8c1599ffec86923b7853b9b24d2e8f752'

def verify_audit(data,original_receipt,delta=None):
    assert original_receipt==BEFORE, 'Original audit receipt must remain unchanged'
    assert hashlib.sha256(data).hexdigest()==AFTER, 'Only the reviewed URI representation change is allowed'
    delta=delta if delta is not None else (HERE.parent/'pdf-combined-20261116/support-uri-serialization.patch').read_bytes()
    assert hashlib.sha256(delta).hexdigest()==PATCH, 'Exact reviewed delta required'
    with tempfile.TemporaryDirectory(prefix='audit-integrity-')as tmp:
        root=pathlib.Path(tmp);path=root/REL;path.parent.mkdir(parents=True);path.write_bytes(data)
        patch=root/'reviewed.patch';patch.write_bytes(delta)
        for check in [True,False]:
            command=['git','apply','--reverse']+(['--check']if check else[])+[str(patch)]
            result=subprocess.run(command,cwd=root,capture_output=True,timeout=10)
            assert result.returncode==0, 'Reviewed delta cannot be exactly reversed'
        assert hashlib.sha256(path.read_bytes()).hexdigest()==BEFORE, 'Audit outside reviewed delta changed'
    return {'originalSha256':BEFORE,'currentSha256':AFTER,'deltaSha256':PATCH,'originalReceiptPreserved':True}
