"""Plain glTF-friendly materials before export (build.py)."""
import bpy


def images_of(mat):
    out = {}
    if not mat or not mat.node_tree:
        return out
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            nm = (n.image.name + ' ' + n.image.filepath).lower()
            if 'normal' in nm or '_nrm' in nm or '_nor' in nm:
                out.setdefault('normal', n.image)
            elif 'rough' in nm or 'spec' in nm or 'bump' in nm or 'ao' in nm.split('_'):
                continue
            else:
                out.setdefault('color', n.image)
    return out


def plain(name, imgs, alpha=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9
    if 'color' in imgs:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = imgs['color']
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha:
            nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
            m.blend_method = 'CLIP'
    if 'normal' in imgs:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = imgs['normal']
        t.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def prepare(basemesh, garments, rig, spec):
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        # Cloth and skin are smooth: no faceting (the draped cloaks are made flat-shaded).
        o.data.polygons.foreach_set('use_smooth', [True] * len(o.data.polygons))
        alpha = any(s in o.name.lower() for s in ('eyebrow', 'eyelash', 'hair', 'beard'))
        for i, old in enumerate(o.data.materials):
            imgs = images_of(old)
            kind = ('head' if old and old.name.startswith('head') else 'skin') if o == basemesh else o.name
            o.data.materials[i] = plain(kind, imgs, alpha)
