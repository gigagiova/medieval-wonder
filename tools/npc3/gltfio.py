"""
Read and write the v2 townsfolk's JSON glTF (public/models/npc2/<body>.json:
one embedded base64 buffer, external webp images) without Blender.

Edits replace whole accessors of garment primitives or add new garment
nodes. When the file is written, the buffer is rebuilt from the accessors
still referenced, each copied byte for byte unless it was replaced: the body,
the head and the eyes (the accepted face fitting) stay bit-identical, which
`body_digest` checks.
"""
import base64, hashlib, json
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
CODE = {np.dtype(v): k for k, v in CT.items()}


class Gltf:
    def __init__(self, path):
        self.path = path
        self.j = json.load(open(path))
        uri = self.j['buffers'][0]['uri']
        self.buf = base64.b64decode(uri.split(',', 1)[1])
        self.new = {}  # accessor index -> replacement array

    # ---------------------------------------------------------------- reading
    def acc(self, i):
        if i in self.new:
            return self.new[i]
        a = self.j['accessors'][i]
        bv = self.j['bufferViews'][a['bufferView']]
        n, c = a['count'], NC[a['type']]
        dt = np.dtype(CT[a['componentType']])
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0) or dt.itemsize * c
        if stride == dt.itemsize * c:
            arr = np.frombuffer(self.buf, dt, n * c, off).reshape(n, c)
        else:
            arr = np.stack([np.frombuffer(self.buf, dt, c, off + k * stride) for k in range(n)])
        arr = arr.astype(np.float64) if dt == np.float32 else arr.astype(np.int64)
        if a.get('normalized'):
            arr = arr / float(np.iinfo(dt).max)
        return arr if c > 1 else arr[:, 0]

    def raw(self, i):
        """An accessor's stored values in their own component type."""
        a = self.j['accessors'][i]
        bv = self.j['bufferViews'][a['bufferView']]
        n, c = a['count'], NC[a['type']]
        dt = np.dtype(CT[a['componentType']])
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0) or dt.itemsize * c
        b = np.frombuffer(self.buf, np.uint8)
        rows = np.stack([b[off + k * stride: off + k * stride + dt.itemsize * c] for k in range(n)]) if stride != dt.itemsize * c else b[off: off + n * c * dt.itemsize]
        return np.ascontiguousarray(rows).view(dt).reshape(n, c)

    def meta(self):
        e = self.j['scenes'][0]['extras']['npc2']
        return json.loads(e) if isinstance(e, str) else e

    def set_meta(self, m):
        self.j['scenes'][0]['extras']['npc2'] = json.dumps(m)

    def node(self, name):
        return next(n for n in self.j['nodes'] if n['name'] == name)

    def prims(self, node_name):
        n = self.node(node_name)
        return self.j['meshes'][n['mesh']]['primitives']

    def mesh(self, node_name, k=0):
        """A primitive's arrays: P N UV J W HIDE (by vertex) and F (triangles)."""
        p = self.prims(node_name)[k]
        A = p['attributes']
        out = {'F': self.acc(p['indices']).reshape(-1, 3)}
        for key, name in (('P', 'POSITION'), ('N', 'NORMAL'), ('UV', 'TEXCOORD_0'), ('J', 'JOINTS_0'), ('W', 'WEIGHTS_0'), ('HIDE', '_HIDE')):
            if name in A:
                out[key] = self.acc(A[name])
        return out

    def joints(self):
        return [self.j['nodes'][i]['name'].replace('mixamorig:', '') for i in self.j['skins'][0]['joints']]

    # ---------------------------------------------------------------- writing
    def _add_acc(self, arr, ctype, kind, target=None):
        arr = np.ascontiguousarray(arr)
        a = {'componentType': ctype, 'count': int(arr.shape[0]), 'type': kind}
        if ctype == 5126 and kind == 'VEC3':
            a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        self.j['accessors'].append(a)
        i = len(self.j['accessors']) - 1
        self.new[i] = arr
        if target:
            a['_target'] = target
        return i

    def put_mesh(self, node_name, m, k=0):
        """Replace a primitive's arrays with those of `m` (same keys as mesh())."""
        p = self.prims(node_name)[k]
        self._fill(p, m)

    def set_attr(self, node_name, k, name, arr, ctype, kind):
        """Replace one vertex attribute of a primitive (the others untouched)."""
        self.prims(node_name)[k]['attributes'][name] = self._add_acc(arr, ctype, kind, 34962)

    def _fill(self, p, m):
        A = p.setdefault('attributes', {})
        A['POSITION'] = self._add_acc(m['P'].astype(np.float32), 5126, 'VEC3', 34962)
        A['NORMAL'] = self._add_acc(m['N'].astype(np.float32), 5126, 'VEC3', 34962)
        if 'UV' in m: A['TEXCOORD_0'] = self._add_acc(m['UV'].astype(np.float32), 5126, 'VEC2', 34962)
        J = m['J']
        A['JOINTS_0'] = self._add_acc(J.astype(np.uint16 if J.max() > 255 else np.uint8), 5123 if J.max() > 255 else 5121, 'VEC4', 34962)
        A['WEIGHTS_0'] = self._add_acc(m['W'].astype(np.float32), 5126, 'VEC4', 34962)
        if 'HIDE' in m: A['_HIDE'] = self._add_acc(m['HIDE'].astype(np.float32), 5126, 'SCALAR', 34962)
        F = m['F'].reshape(-1).astype(np.uint32 if m['P'].shape[0] > 65535 else np.uint16)
        p['indices'] = self._add_acc(F, 5125 if F.dtype == np.uint32 else 5123, 'SCALAR', 34963)

    def add_garment(self, name, m, like, material=None, extras=None):
        """A new skinned garment node G_<name>, a sibling of node `like` (same skin and parent)."""
        src = self.node(like)
        mesh = {'name': 'G_' + name, 'primitives': [{'attributes': {}, 'mode': 4}]}
        if material is not None:
            mesh['primitives'][0]['material'] = material
        self.j['meshes'].append(mesh)
        self._fill(mesh['primitives'][0], m)
        node = {'name': 'G_' + name, 'mesh': len(self.j['meshes']) - 1, 'skin': src['skin']}
        if extras:
            node['extras'] = extras
        self.j['nodes'].append(node)
        ni = len(self.j['nodes']) - 1
        si = self.j['nodes'].index(src)
        for n in self.j['nodes']:
            if si in n.get('children', []):
                n['children'].append(ni)
                break
        else:
            self.j['scenes'][0]['nodes'].append(ni)
        return ni

    def save(self, path):
        """Rebuild the buffer: referenced accessors only, untouched ones byte-for-byte."""
        used = set()
        for m in self.j['meshes']:
            for p in m['primitives']:
                used.update(p['attributes'].values())
                if 'indices' in p: used.add(p['indices'])
        for s in self.j.get('skins', []):
            if 'inverseBindMatrices' in s: used.add(s['inverseBindMatrices'])
        for an in self.j.get('animations', []):
            for smp in an['samplers']: used.update([smp['input'], smp['output']])
        out = bytearray()
        views, accs, remap = [], [], {}
        for i, a in enumerate(self.j['accessors']):
            if i not in used:
                continue
            a = dict(a)
            target = a.pop('_target', None)
            if i in self.new:
                data = self.new[i].tobytes()
                a.pop('byteOffset', None)
                view = {'buffer': 0, 'byteLength': len(data)}
                if target: view['target'] = target
            else:
                # Untouched: the same values, de-interleaved into a tight view (bit-identical).
                bv = self.j['bufferViews'][a['bufferView']]
                data = self.raw(i).tobytes()
                a.pop('byteOffset', None)
                view = {'buffer': 0, 'byteLength': len(data)}
                if 'target' in bv: view['target'] = bv['target']
            while len(out) % 4: out.append(0)
            view['byteOffset'] = len(out)
            out += data
            views.append(view)
            a['bufferView'] = len(views) - 1
            remap[i] = len(accs)
            accs.append(a)
        # Views not owned by accessors (images are external here; keep any others).
        for m in self.j['meshes']:
            for p in m['primitives']:
                p['attributes'] = {k: remap[v] for k, v in p['attributes'].items()}
                if 'indices' in p: p['indices'] = remap[p['indices']]
        for s in self.j.get('skins', []):
            if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = remap[s['inverseBindMatrices']]
        for an in self.j.get('animations', []):
            for smp in an['samplers']: smp['input'] = remap[smp['input']]; smp['output'] = remap[smp['output']]
        for img in self.j.get('images', []):
            if 'bufferView' in img: raise ValueError('embedded image not supported')
        self.j['accessors'] = accs
        self.j['bufferViews'] = views
        self.j['buffers'] = [{'byteLength': len(out), 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(bytes(out)).decode()}]
        json.dump(self.j, open(path, 'w'), separators=(',', ':'))


def body_digest(path):
    """A hash of everything that is not a garment: body (skin, head, eyes), skin, materials, images."""
    g = Gltf(path)
    h = hashlib.sha256()
    for n in g.j['nodes']:
        if 'mesh' not in n or n['name'].startswith('G_'):
            continue
        for p in g.j['meshes'][n['mesh']]['primitives']:
            for k in sorted(p['attributes']):
                if k == '_HIDE':
                    continue
                h.update(k.encode()); h.update(np.ascontiguousarray(g.acc(p['attributes'][k])).tobytes())
            h.update(np.ascontiguousarray(g.acc(p['indices'])).tobytes())
            h.update(json.dumps(g.j['materials'][p['material']], sort_keys=True).encode() if 'material' in p else b'')
    h.update(np.ascontiguousarray(g.acc(g.j['skins'][0]['inverseBindMatrices'])).tobytes())
    for n in g.j['nodes']:
        if 'mesh' not in n:
            h.update(json.dumps([n['name'], n.get('translation'), n.get('rotation'), n.get('scale')]).encode())
    h.update(json.dumps(g.j['images'], sort_keys=True).encode())
    return h.hexdigest()
