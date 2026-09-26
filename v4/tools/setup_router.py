#!/usr/bin/env python3
"""Install pinned, local routing tools. Default runtime is macOS Apple Silicon."""
import argparse
import hashlib
from pathlib import Path
import tarfile
import urllib.request

JAR='https://github.com/freerouting/freerouting/releases/download/v2.4.1/freerouting-2.4.1.jar'
JAVA='https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jre_aarch64_mac_hotspot_25.0.4.1_1.tar.gz'

def fetch(url,path,sha):
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
        temp=path.with_suffix(path.suffix+'.download')
        with urllib.request.urlopen(url,timeout=60) as response, temp.open('wb') as dest:
            while True:
                block=response.read(1024*1024)
                if not block: break
                dest.write(block)
        if hashlib.sha256(temp.read_bytes()).hexdigest()!=sha:
            temp.unlink(); raise RuntimeError('Download checksum mismatch: '+url)
        temp.replace(path)
    return path

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--out',type=Path,default=Path(__file__).resolve().parents[2]/'output_v4/tools')
    args=p.parse_args(); args.out.mkdir(parents=True,exist_ok=True)
    fetch(JAR,args.out/'freerouting-2.4.1.jar','251101c3eeac22d7e7dfcf6796603279e5d1000283eb82d8f093780f7afc6aa9')
    archive=fetch(JAVA,args.out/'java25.tar.gz','5b02bcc908da092e7e00b9772d4f9bbb87f44a60b7c90f7cf5a91a1d98f37e1b')
    with tarfile.open(archive) as tar: tar.extractall(args.out,filter='data')
    print('Router ready in '+str(args.out))
