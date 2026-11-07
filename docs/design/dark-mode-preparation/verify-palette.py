"""Prepared palette arithmetic and logo geometry checks; not full UI conformance."""
from pathlib import Path
import json,xml.etree.ElementTree as ET
root=Path(__file__).parent
t=json.loads((root/'tokens.json').read_text())['color']
def lum(h):
 c=[int(h[i:i+2],16)/255 for i in (1,3,5)]
 return sum(x*w for x,w in zip([v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c],[.2126,.7152,.0722]))
def ratio(a,b):
 x,y=sorted([lum(a),lum(b)]);return (y+.05)/(x+.05)
checks=[]
for fg in ['ink','muted','primary','accent-text']:
 for bg in ['bg','surface','surface-raised','surface-hover']:
  checks.append((fg,bg,4.5))
checks += [('on-action',s,4.5) for s in ['action','action-hover','action-pressed']]
checks += [('on-danger-action',s,4.5) for s in ['danger-action','danger-action-hover']]
checks += [(s,s+'-soft',4.5) for s in ['success','warning','danger']]
checks += [('on-accent','accent',4.5),('ink','selected',4.5),('disabled-text','disabled-bg',4.5),('primary','info-soft',4.5)]
checks += [('control-border',s,3) for s in ['field','surface','surface-raised','surface-hover']]
checks += [('focus',s,3) for s in ['bg','surface-raised','action']]
checks += [('logo-blue','track',3),('accent','track',3)]
rows=[{'foreground':f,'background':b,'ratio':round(ratio(t[f],t[b]),3),'threshold':v,'pass':ratio(t[f],t[b])>=v} for f,b,v in checks]
# Ignore only fill values; all other attributes, geometry and tree structure must match.
def structure(path):
 def walk(e):return (e.tag,tuple(sorted((k,v)for k,v in e.attrib.items() if k!='fill')),tuple(walk(c)for c in e))
 return walk(ET.parse(path).getroot())
original=structure(root/'assets/logo-light-original.svg')
geometry={name:structure(root/'assets'/name)==original for name in ['logo-dark-color.svg','logo-dark-exact-color.svg','logo-dark-mono.svg']}
result={'scope':'Declared solid foreground/background pairs. Does not inspect full browser UI, alpha compositing, images or unspecified pairs. Logo ratios are optical diagnostics, not a WCAG logo requirement.','pairs':rows,'logoGeometryUnchanged':geometry,'logoComparisonOnRaisedSurface':{'originalBlue':round(ratio('#0751F8',t['surface-raised']),3),'proposedBlue':round(ratio(t['logo-blue'],t['surface-raised']),3)},'pass':all(r['pass'] for r in rows)and all(geometry.values())}
(root/'contrast-report.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'pairs':len(rows),'failures':[r for r in rows if not r['pass']],'geometry':geometry,'pass':result['pass']},indent=2))
if not result['pass']:raise SystemExit(1)
