"""Download public validation samples; content hashes make the evaluated revision explicit."""
import hashlib,json,pathlib,urllib.request
root=pathlib.Path(__file__).parent
(root/'samples').mkdir(exist_ok=True)
(root/'output').mkdir(exist_ok=True)
for sample in json.loads((root/'samples.json').read_text()):
    destination=root/'samples'/(sample['name']+'.pdf')
    if not destination.exists(): urllib.request.urlretrieve(sample['url'],destination)
    actual=hashlib.sha256(destination.read_bytes()).hexdigest()
    if actual!=sample['sha256']: raise RuntimeError(f"Sample revision changed: {sample['name']}")
    print(sample['name'],'verified')
