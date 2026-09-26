"""Exercise worker failures using harmless Python children, not KiCad crashes."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from rosebear.job_guard import JobBusy,ProgressLimit,supervise


class ProgressTests(unittest.TestCase):
    def test_ripup_cycles_do_not_reset_stagnation(self):
        now=[0];guard=ProgressLimit(300,120,3,lambda:now[0])
        guard.observe((2,5));guard.observe((1,5));guard.observe((8,0));guard.observe((2,0))
        with self.assertRaisesRegex(RuntimeError,'no improvement'):guard.observe((1,5))

    def test_cleanup_improvements_count_and_time_limits_apply(self):
        now=[0];guard=ProgressLimit(300,10,3,lambda:now[0])
        guard.observe((0,8));now[0]=9;guard.observe((0,7));now[0]=18;guard.check_time()
        now[0]=19
        with self.assertRaisesRegex(RuntimeError,'no improvement'):guard.check_time()
        guard=ProgressLimit(5,100,3,lambda:now[0]);now[0]=24
        with self.assertRaisesRegex(RuntimeError,'completion time limit'):guard.check_time()


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.lock=self.root/'worker.lock';self.status=self.root/'status.json'
    def tearDown(self):self.temp.cleanup()
    def run_worker(self,source,timeout=2):
        return supervise([sys.executable,'-c',source],self.lock,self.status,timeout,grace=.1)
    def assert_stopped(self,pid):
        deadline=time.monotonic()+2
        while time.monotonic()<deadline:
            result=subprocess.run(['ps','-p',str(pid),'-o','stat='],capture_output=True,text=True)
            if result.returncode or result.stdout.strip().startswith('Z'):return
            time.sleep(.05)
        self.fail('Test worker remains alive: '+str(pid))
    def descendant_source(self,exit_early):
        pidfile=self.root/'child.pid'
        child='import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)'
        return ('import subprocess,sys,time\n'
                'from pathlib import Path\n'
                'p=subprocess.Popen([sys.executable,"-c",'+repr(child)+'])\n'
                'Path('+repr(str(pidfile))+').write_text(str(p.pid))\n'
                'time.sleep(.2)\n'+('sys.exit(7)\n' if exit_early else 'time.sleep(30)\n'))
    def test_success_and_lock_released(self):
        self.assertEqual(self.run_worker('pass'),0)
        self.assertEqual(self.run_worker('pass'),0)
        self.assertEqual(json.loads(self.status.read_text())['status'],'completed')
    def test_second_worker_is_rejected(self):
        with self.lock.open('a') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(JobBusy):self.run_worker('raise AssertionError("must not start")')
        self.assertFalse(self.status.exists())
    def test_timeout_kills_worker_and_term_resistant_descendant(self):
        self.assertEqual(self.run_worker(self.descendant_source(False),.6),124)
        self.assert_stopped(int((self.root/'child.pid').read_text()))
        self.assert_stopped(json.loads(self.status.read_text())['worker_pid'])
        self.assertEqual(json.loads(self.status.read_text())['status'],'overall timeout')
    def test_failed_worker_cleans_up_surviving_descendant(self):
        self.assertEqual(self.run_worker(self.descendant_source(True)),7)
        self.assert_stopped(int((self.root/'child.pid').read_text()))
        self.assertEqual(json.loads(self.status.read_text())['status'],'worker failed')
    def test_abrupt_worker_death_cleans_up_descendant(self):
        source=self.descendant_source(True).replace('sys.exit(7)','import os,signal;os.kill(os.getpid(),signal.SIGKILL)')
        self.assertEqual(self.run_worker(source),137)
        self.assert_stopped(int((self.root/'child.pid').read_text()))
        self.assertEqual(json.loads(self.status.read_text())['exit_code'],-9)

    def test_interrupt_cleans_up_worker_group(self):
        module_root=str(Path(__file__).resolve().parents[1])
        source=('import sys\nsys.path.insert(0,'+repr(module_root)+')\n'
                'from rosebear.job_guard import supervise\n'
                'sys.exit(supervise('+repr([sys.executable,'-c',self.descendant_source(False)])+','+
                repr(str(self.lock))+','+repr(str(self.status))+',30,grace=.1))')
        supervisor=subprocess.Popen([sys.executable,'-c',source])
        try:
            deadline=time.monotonic()+5
            while not (self.root/'child.pid').exists() and time.monotonic()<deadline:time.sleep(.02)
            self.assertTrue((self.root/'child.pid').exists())
            supervisor.send_signal(signal.SIGTERM)
            self.assertEqual(supervisor.wait(timeout=5),143)
            self.assert_stopped(int((self.root/'child.pid').read_text()))
            self.assert_stopped(json.loads(self.status.read_text())['worker_pid'])
        finally:
            if supervisor.poll() is None:supervisor.terminate();supervisor.wait(timeout=5)
