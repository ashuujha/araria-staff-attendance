"""Read the supplied XLSX with stdlib only. Never publishes staff information."""
import argparse, json, re, zipfile, unicodedata, xml.etree.ElementTree as E
from pathlib import Path
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def read_xlsx(path):
    with zipfile.ZipFile(path) as z:
        strings=[''.join(t.itertext()) for t in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',NS)] if 'xl/sharedStrings.xml' in z.namelist() else []
        rows=[]
        for r in E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('s:sheetData/s:row',NS):
            cells={}
            for c in r:
                v=c.find('s:v',NS); value=v.text if v is not None else ''
                if c.get('t')=='s': value=strings[int(value)]
                if c.get('t')=='inlineStr': value=''.join(c.find('s:is',NS).itertext())
                cells[re.sub(r'\d','',c.get('r'))]=unicodedata.normalize('NFC', str(value or '')).strip()
            rows.append((int(r.get('r')),cells))
        return rows

def normalize(rows):
    candidates=[]; vacancies=[]; needs_fix=[]; current_panchayat=''
    for number,c in rows:
        if number<6: continue
        if c.get('B'): current_panchayat=c['B']
        name=re.sub(r'\s+',' ',c.get('E','')).strip()
        if not name or name in ('-','—','रिक्त','रिक्त पद'): vacancies.append(number); continue
        phones=[]
        for p in re.findall(r'(?:\+?91[\s-]*)?([6-9]\d{9})(?!\d)',c.get('F','')):
            if p not in phones: phones.append(p)
        emails=re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',c.get('G',''))
        item={'name':name,'phones':phones,'email':emails[0].lower() if emails else None,'assignments':[{'panchayat':current_panchayat,'position':re.sub(r'\s+',' ',c.get('C','')).strip(),'department':re.sub(r'\s+',' ',c.get('D','')).strip()}],'source_rows':[number]}
        if not phones and not emails: needs_fix.append(item); continue
        candidates.append(item)
    # Union-find handles transitive overlaps, including secondary numbers.
    parent=list(range(len(candidates))); identities={}
    def find(i):
        while parent[i]!=i: parent[i]=parent[parent[i]]; i=parent[i]
        return i
    for i,item in enumerate(candidates):
        keys=['phone:'+p for p in item['phones']]+(['email:'+item['email']] if item['email'] else [])
        for key in keys:
            if key in identities: parent[find(i)]=find(identities[key])
            else: identities[key]=i
    grouped={}
    for i,item in enumerate(candidates):
        root=find(i)
        if root not in grouped: grouped[root]={**item,'phones':[],'assignments':[],'source_rows':[],'name_conflicts':[]}
        account=grouped[root]
        if item['name']!=account['name'] and item['name'] not in account['name_conflicts']: account['name_conflicts'].append(item['name'])
        if not account['email'] and item['email']: account['email']=item['email']
        for field in ('phones','assignments','source_rows'):
            for value in item[field]:
                if value not in account[field]: account[field].append(value)
    staff=list(grouped.values())
    # Conflicting names are quarantined for admin review, not silently merged into an account.
    conflicts=[a for a in staff if a['name_conflicts']]
    staff=[a for a in staff if not a['name_conflicts']]
    needs_fix+=conflicts
    return {'staff':staff,'needs_fix':needs_fix,'vacancy_rows':vacancies,'summary':{'source_rows':len(candidates)+len(needs_fix)-len(conflicts),'accounts_ready':len(staff),'needs_fix':len(needs_fix),'vacancies':len(vacancies),'name_conflicts':len(conflicts),'panchayats':len(set(a['panchayat'] for i in staff+needs_fix for a in i['assignments']))}}
if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('file',nargs='?',default='../ALL STAFF ARARIA.xlsx'); p.add_argument('--output',default='private/staff-import.json'); args=p.parse_args()
    result=normalize(read_xlsx(args.file)); target=Path(args.output); target.parent.mkdir(parents=True,exist_ok=True); target.write_text(json.dumps(result,ensure_ascii=False,indent=2)); target.chmod(0o600)
    print(json.dumps(result['summary'],ensure_ascii=False)); print('Private import written to '+str(target))
