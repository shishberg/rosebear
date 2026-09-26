"""Supervise native workers outside their crash-prone Python process.

One worker per checkout; a wall-clock deadline and process-group cleanup also
cover native calls that never return. Failed workers are never restarted.
"""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


class JobBusy(RuntimeError):
    pass


def stop_group(process, grace=2.0):
    def send(sig):
        try:os.killpg(process.pid,sig)
        except ProcessLookupError:return False
        except PermissionError:
            # macOS can deny a group probe during orphan/zombie teardown.
            # Inspect the group rather than assuming either success or liveness;
            # signal only live members owned by this user as a fallback.
            snapshot=subprocess.run(['ps','-axo','pid=,pgid=,uid=,stat='],capture_output=True,text=True,check=True,timeout=5)
            members=[]
            for row in snapshot.stdout.splitlines():
                fields=row.split()
                if len(fields)>=4 and int(fields[1])==process.pid and int(fields[2])==os.getuid() and not fields[3].startswith('Z'):
                    members.append(int(fields[0]))
            if not members:return False
            if sig:
                for pid in members:
                    try:os.kill(pid,sig)
                    except ProcessLookupError:pass
        return True
    if send(signal.SIGTERM):
        deadline=time.monotonic()+grace
        while time.monotonic()<deadline:
            process.poll()
            if not send(0):break
            time.sleep(.05)
        send(signal.SIGKILL)
    process.wait()


def supervise(command, lock_path, status_path, timeout, env=None, grace=2.0):
    lock_path=Path(lock_path);status_path=Path(status_path)
    lock_path.parent.mkdir(parents=True,exist_ok=True)
    with lock_path.open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise JobBusy('Another v4 build/routing worker is already running in this checkout')
        started=time.monotonic();process=None;code=1;reason='failed to start'
        def record(state):
            data={'status':state,'command':command,'worker_pid':process.pid if process else None,
                  'elapsed_seconds':round(time.monotonic()-started,2),'timeout_seconds':timeout,
                  'exit_code':code if state!='running' else None,'automatic_restart':False}
            temp=status_path.with_suffix('.tmp');temp.write_text(json.dumps(data,indent=2)+'\n');temp.replace(status_path)
        def interrupt(signum,frame):raise InterruptedError(signum)
        old={s:signal.signal(s,interrupt) for s in (signal.SIGINT,signal.SIGTERM)}
        try:
            process=subprocess.Popen(command,start_new_session=True,env=env)
            record('running')
            try:
                code=process.wait(timeout=timeout)
                reason='completed' if code==0 else 'worker failed'
            except subprocess.TimeoutExpired:
                code=124;reason='overall timeout'
            except InterruptedError as error:
                code=128+error.args[0];reason='interrupted'
        finally:
            # A second interrupt must not prevent descendant cleanup.
            for s in old:signal.signal(s,signal.SIG_IGN)
            try:
                if process is not None:stop_group(process,grace)
                record(reason)
            finally:
                for s,handler in old.items():signal.signal(s,handler)
        if code:print('V4 job stopped: '+reason+'; related child processes cleaned up.',file=sys.stderr,flush=True)
        return code if code>=0 else 128-code


def guard_entry(root, entry):
    """Call before importing wx/pcbnew, including for direct script invocation."""
    entry=str(Path(entry).resolve());marker='ROSEBEAR_NATIVE_WORKER'
    if os.environ.get(marker)==entry:
        os.environ.pop(marker,None)
        os.nice(10)
        return
    config=json.loads((root/'v4/config.json').read_text())
    timeout=config['router'].get('job_timeout_seconds',900)
    env=dict(os.environ);env[marker]=entry
    try:
        code=supervise([sys.executable,entry]+sys.argv[1:],root/'output_v4/tools/native-job.lock',
                       root/'output_v4/native-job-status.json',timeout,env)
    except JobBusy as error:
        print(str(error),file=sys.stderr);code=75
    sys.exit(code)


class ProgressLimit:
    """Stop when the best result stops improving, even across rip-up cycles."""
    def __init__(self, seconds=300, stale_seconds=120, stale_iterations=25, clock=time.monotonic):
        self.clock=clock;self.started=clock();self.improved=self.started
        self.seconds=seconds;self.stale_seconds=stale_seconds;self.limit=stale_iterations
        self.best=None;self.stale=0

    def check_time(self):
        now=self.clock()
        if now-self.started>=self.seconds:raise RuntimeError('Routing completion time limit reached; checkpoint retained')
        if now-self.improved>=self.stale_seconds:raise RuntimeError('Routing stopped: no improvement within time limit; checkpoint retained')

    def observe(self, score):
        self.check_time()
        if self.best is None or score<self.best:
            self.best=score;self.improved=self.clock();self.stale=0
        else:self.stale+=1
        if self.stale>=self.limit:raise RuntimeError('Routing stopped: no improvement after '+str(self.stale)+' iterations; checkpoint retained')
