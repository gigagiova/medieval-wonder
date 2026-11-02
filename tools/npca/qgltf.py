"""Minimal glTF (JSON + external .bin or data-URI buffers) reading and writing with numpy,
for packing the Track A townsfolk (tools/npca/build.py)."""
import base64, json, os
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def quat_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def trs(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    M = np.eye(4)
    R = quat_mat(n.get('rotation', [0, 0, 0, 1]))
    S = np.diag(n.get('scale', [1, 1, 1]))
    M[:3, :3] = R @ S
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


class Src:
    def __init__(self, path):
        self.path = path
        self.dir = os.path.dirname(path)
        self.j = json.load(open(path))
        self.bufs = []
        for b in self.j['buffers']:
            u = b['uri']
            self.bufs.append(base64.b64decode(u.split(',', 1)[1]) if u.startswith('data:') else open(os.path.join(self.dir, u), 'rb').read())
        self.parent = {}
        for i, n in enumerate(self.j['nodes']):
            for c in n.get('children', []):
                self.parent[c] = i

    def acc(self, i):
        a = self.j['accessors'][i]
        bv = self.j['bufferViews'][a['bufferView']]
        n, c = a['count'], NC[a['type']]
        dt = np.dtype(CT[a['componentType']])
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0) or dt.itemsize * c
        buf = self.bufs[bv['buffer']]
        if stride == dt.itemsize * c:
            arr = np.frombuffer(buf, dt, n * c, off).reshape(n, c)
        else:
            arr = np.stack([np.frombuffer(buf, dt, c, off + k * stride) for k in range(n)])
        if a.get('normalized'):
            arr = arr.astype(np.float64) / float(np.iinfo(dt).max)
        arr = arr.astype(np.float64) if arr.dtype.kind == 'f' else arr.astype(np.int64)
        return arr if c > 1 else arr[:, 0]

    def world(self, i):
        M = trs(self.j['nodes'][i])
        while i in self.parent:
            i = self.parent[i]
            M = trs(self.j['nodes'][i]) @ M
        return M

    def node_index(self, name):
        return next(i for i, n in enumerate(self.j['nodes']) if n.get('name') == name)

    def joint_names(self, skin=0):
        return [self.j['nodes'][i]['name'] for i in self.j['skins'][skin]['joints']]

    def mesh_nodes(self):
        return [(i, n) for i, n in enumerate(self.j['nodes']) if 'mesh' in n]

    def prims(self, node_i):
        """Each primitive of a node's mesh: dict P N UV J W F material (joints as names via the node's skin)."""
        n = self.j['nodes'][node_i]
        names = self.joint_names(n.get('skin', 0)) if 'skin' in n else None
        out = []
        for p in self.j['meshes'][n['mesh']]['primitives']:
            A = p['attributes']
            m = {'F': self.acc(p['indices']).reshape(-1, 3), 'P': self.acc(A['POSITION']), 'N': self.acc(A['NORMAL']), 'UV': self.acc(A['TEXCOORD_0'])}
            if 'JOINTS_0' in A:
                m['J'] = self.acc(A['JOINTS_0'])
                m['W'] = self.acc(A['WEIGHTS_0'])
                m['jn'] = names
            mat = self.j['materials'][p['material']] if 'material' in p else {}
            m['material'] = mat.get('name', '')
            out.append(m)
        return out
