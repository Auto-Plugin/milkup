"""Pass only the owned snapshot/result/stop channels to the exact packaged helper."""
import fcntl
import os
import sys

binary, result, stop, owner = sys.argv[1:]
assert os.getuid() != 0 and os.getppid() == int(owner)
os.setsid()
r = fcntl.fcntl(int(result), fcntl.F_DUPFD_CLOEXEC, 5)
s = fcntl.fcntl(int(stop), fcntl.F_DUPFD_CLOEXEC, 5)
os.dup2(r, 3, inheritable=True)
os.dup2(s, 4, inheritable=True)
for fd in {r, s, int(result), int(stop)} - {3, 4}:
    os.close(fd)
assert os.getppid() == int(owner)
os.execve(binary, [binary, '--milkup-internal-output-helper'], os.environ)
