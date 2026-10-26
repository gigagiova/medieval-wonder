"""unpack.py DEST ZIP... : extract only asset data files (no code), refusing path traversal."""
import sys, zipfile, os
dest = os.path.abspath(sys.argv[1])
OK = {'.mhclo', '.obj', '.png', '.jpg', '.jpeg', '.mhmat', '.thumb', '.json', '.mhpxy', '.proxy', '.target', '.mhm', '.tif', '.tga', '.webp', '.bvh', '.mhpose', '.txt', '.licence', '.license', '.mhw', '.mhskel', '.gz', '.npz', '.bmp'}
for zp in sys.argv[2:]:
    z = zipfile.ZipFile(zp)
    n = 0
    for info in z.infolist():
        p = info.filename
        if p.endswith('/'):
            continue
        ext = os.path.splitext(p)[1].lower()
        if ext not in OK:
            print('skip', p); continue
        out = os.path.abspath(os.path.join(dest, p))
        if not out.startswith(dest + os.sep):
            print('BAD', p); continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with z.open(info) as s, open(out, 'wb') as f:
            f.write(s.read())
        n += 1
    print(zp, n)
