import argparse, hashlib, json, pathlib, sys
REQUIRED = ['npm-ci','hardening-verify','node-tests','rendered-tests','lint','build','production-audit','full-audit','docker-version','docker-build','docker-image-inspect','docker-run','docker-smoke']
KNOWN = {'GHSA-vfj7-8cjw-p6xm','GHSA-rj75-hqrm-r3gf'}
def read(path): return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
def portable(source):
    entries = source.get('entries')
    if not isinstance(entries,list) or not entries: raise ValueError('Missing source manifest entries')
    normalized = sorted([{'path':e['path'],'sha256':e.get('sha256'),'deleted':bool(e.get('deleted',False)),'executable':bool(e.get('mode',0)&0o111)} for e in entries],key=lambda e:e['path'])
    if len({e['path'] for e in normalized}) != len(normalized): raise ValueError('Duplicate source manifest paths')
    return hashlib.sha256(json.dumps(normalized,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def assess(commit,summary,source):
    failures=[]
    if summary.get('head') != commit: failures.append('Commit SHA mismatch')
    if summary.get('automatedEvidence') != 'passed': failures.append('Automated evidence is not passed')
    if summary.get('sourceUnchanged') is not True: failures.append('Source changed or stability not established')
    if source.get('sha256') != summary.get('sourceFingerprint'): failures.append('Summary/source fingerprint mismatch')
    steps={s.get('name'):s for s in summary.get('steps',[])}
    for name in REQUIRED:
        step=steps.get(name)
        if not step: failures.append('Missing step: '+name); continue
        allowed={0,1} if name=='full-audit' else {0}
        if step.get('exit') not in allowed or step.get('signal') or step.get('error'): failures.append('Failed step: '+name)
    audit=steps.get('full-audit',{})
    advisories=set(audit.get('advisories',[]))
    if not advisories.issubset(KNOWN): failures.append('New or unidentified advisory')
    total=audit.get('vulnerabilities',{}).get('total')
    if not isinstance(total,int): failures.append('Full-audit count missing')
    elif total and not advisories: failures.append('Unexplained full-audit findings')
    if steps.get('production-audit',{}).get('vulnerabilities',{}).get('total') != 0: failures.append('Production audit not confirmed clean')
    checks=summary.get('checks',[])
    for label in ['standalone','container']:
        routes={c.get('route') for c in checks if c.get('label')==label and c.get('status')==200}
        if not {'/login','/register','/projects','/settings'}.issubset(routes): failures.append('Missing route smoke: '+label)
        assets=[c for c in checks if c.get('label')==label and c.get('asset')]
        if not assets or any(c.get('status')!=200 or not c.get('bytes') for c in assets): failures.append('Missing/failed assets: '+label)
        if not any('.css' in c['asset'] for c in assets) or not any('.js' in c['asset'] for c in assets): failures.append('CSS/JS evidence missing: '+label)
    if not summary.get('containerImage'): failures.append('Container image reference missing')
    return {'failures':failures,'portableSourceFingerprint':portable(source),'rawSourceFingerprint':summary.get('sourceFingerprint'),'node':summary.get('node'),'reportedAuditCount':total,'registryAuditClean':summary.get('registryAuditClean'),'formalSignoffFromSummary':summary.get('formalSignoff')}
def main():
    p=argparse.ArgumentParser();p.add_argument('--commit',required=True)
    for provider in ['github','gitlab']:
        p.add_argument('--'+provider+'-summary',required=True);p.add_argument('--'+provider+'-source',required=True)
    p.add_argument('--output');args=p.parse_args()
    report={'commit':args.commit,'formalApprovalGranted':False}
    summaries={}
    for provider in ['github','gitlab']:
        summary=read(getattr(args,provider+'_summary'));source=read(getattr(args,provider+'_source'))
        summaries[provider]=summary;report[provider]=assess(args.commit,summary,source)
    report['rawFingerprintMatch']=report['github']['rawSourceFingerprint']==report['gitlab']['rawSourceFingerprint']
    report['portableFingerprintMatch']=report['github']['portableSourceFingerprint']==report['gitlab']['portableSourceFingerprint']
    report['nodeVersionMatch']=report['github']['node']==report['gitlab']['node']
    report['providerIdsPresent']=bool(summaries['github'].get('hosted',{}).get('github')) and bool(summaries['gitlab'].get('hosted',{}).get('gitlab'))
    failed=any(report[v]['failures'] for v in ['github','gitlab']) or not report['portableFingerprintMatch'] or not report['nodeVersionMatch'] or not report['providerIdsPresent']
    review=not failed and not report['rawFingerprintMatch']
    report['comparison']='failed' if failed else 'permission_or_manifest_review_required' if review else 'passed'
    encoded=json.dumps(report,indent=2)
    if args.output:
        path=pathlib.Path(args.output)
        if path.exists():raise SystemExit('Refusing existing comparison output')
        path.parent.mkdir(parents=True,exist_ok=True);path.write_text(encoded+'\n',encoding='utf-8')
    print(encoded)
    sys.exit(1 if failed else 2 if review else 0)
if __name__=='__main__':main()
