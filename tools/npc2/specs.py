"""Bodies, garments and outfits of the v2 townsfolk (see build.py)."""

# Phenotypes are MakeHuman macros (0-1). Skins are MakeHuman's CC0 skins;
# `scan` names a scanned head (public/models/npc) fitted onto the body's
# head by headfit.py, whose photographed skin replaces the painted one there.
BODIES = {
    'm_young': {
        'sex': 'man', 'height': 1.71,
        'phenotype': {'gender': 1.0, 'age': 0.45, 'muscle': 0.6, 'weight': 0.45, 'height': 0.45, 'proportions': 0.6},
        'race': {'caucasian': 0.85, 'asian': 0.05, 'african': 0.1},
        'skin': 'young_caucasian_male/young_caucasian_male.mhmat',
        'scan': 'nathan',
    },
    'm_mid': {
        'sex': 'man', 'height': 1.70,
        'phenotype': {'gender': 1.0, 'age': 0.62, 'muscle': 0.55, 'weight': 0.55, 'height': 0.42, 'proportions': 0.55},
        'race': {'caucasian': 0.85, 'asian': 0.05, 'african': 0.1},
        'skin': 'middleage_caucasian_male/middleage_caucasian_male.mhmat',
        'scan': 'eric',
    },
    'm_old': {
        'sex': 'man', 'height': 1.67,
        'phenotype': {'gender': 1.0, 'age': 0.85, 'muscle': 0.45, 'weight': 0.5, 'height': 0.38, 'proportions': 0.5},
        'race': {'caucasian': 0.9, 'asian': 0.05, 'african': 0.05},
        'skin': 'old_caucasian_male/old_caucasian_male.mhmat',
        'scan': 'manuel',
    },
    'm_elder': {
        'sex': 'man', 'height': 1.64,
        'phenotype': {'gender': 1.0, 'age': 0.95, 'muscle': 0.4, 'weight': 0.55, 'height': 0.33, 'proportions': 0.45},
        'race': {'caucasian': 0.9, 'asian': 0.05, 'african': 0.05},
        'skin': 'old_caucasian_male/old_caucasian_male.mhmat',
        'scan': 'face_grandpa',
    },
    'w_young': {
        'sex': 'woman', 'height': 1.59,
        'phenotype': {'gender': 0.0, 'age': 0.45, 'muscle': 0.45, 'weight': 0.5, 'height': 0.35, 'proportions': 0.6, 'cupsize': 0.5, 'firmness': 0.5},
        'race': {'caucasian': 0.85, 'asian': 0.05, 'african': 0.1},
        'skin': 'young_caucasian_female/young_caucasian_female.mhmat',
        'scan': 'claudia',
    },
    'w_mid': {
        'sex': 'woman', 'height': 1.61,
        'phenotype': {'gender': 0.0, 'age': 0.65, 'muscle': 0.4, 'weight': 0.6, 'height': 0.3, 'proportions': 0.5, 'cupsize': 0.55, 'firmness': 0.4},
        'race': {'caucasian': 0.85, 'asian': 0.05, 'african': 0.1},
        'skin': 'middleage_caucasian_female/middleage_caucasian_female.mhmat',
        'scan': 'sophia',
    },
}

# Garments. `mhclo`: a MakeHuman community asset (path under clothes/),
# fitted and skinned by MPFB. `derive`: cut from another (derive.py).
# `fabric`: which scanned cloth the game lays on it (src/npc/fabric.ts),
# `layer`: the dye slot (tunic, over, belt, head, leg, shoe).
GARMENTS = {
    'robe_src': {'sex': ['man'], 'mhclo': 'donitz_monk_robe/donitz_monk_robe.mhclo', 'only_source': True},
    'robe': {'sex': ['man'], 'derive': {'from': 'robe_src', 'drop': ['rope']}, 'fabric': 'tabby', 'layer': 'tunic', 'map': 'detail', 'skirt': {'top': 0.85, 'hem': 0.55}, 'chains': {'set': 'long', 'around': 'hips', 'n': 12, 'bones': 5, 'parent': 'Hips', 'top': 0.0}},
    'longrobe': {'sex': ['man'], 'derive': {'from': 'robe_src', 'drop': ['rope']}, 'fabric': 'twill', 'layer': 'tunic', 'map': 'detail', 'skirt': {'top': 0.85, 'hem': 0.55}, 'chains': {'set': 'long', 'around': 'hips', 'n': 12, 'bones': 5, 'parent': 'Hips', 'top': 0.0}},
    'rope': {'sex': ['man'], 'derive': {'from': 'robe_src', 'keep': ['rope']}, 'fabric': 'rope', 'layer': 'belt', 'map': 'color'},
    'cowl': {'sex': ['man'], 'mhclo': 'donitz_monk_robe_hood_down/donitz_monk_robe_hood_down.mhclo', 'fabric': 'tabby', 'layer': 'over', 'map': 'detail', 'lift': True, 'nrm': 0.5},
    'hood': {'sex': ['man'], 'mhclo': 'donitz_monk_robe_hood/donitz_monk_robe_hood.mhclo', 'fabric': 'felt', 'layer': 'head', 'map': 'detail', 'lift': True, 'nrm': 0.5},
    'tunic': {'sex': ['man'], 'derive': {'from': 'robe_src', 'cut': 'knee', 'drop': ['capelet', 'rope'], 'collar': 0.012}, 'fabric': 'tabby', 'layer': 'tunic', 'map': 'detail', 'skirt': {'top': 0.9, 'hem': 0.75}, 'chains': {'set': 'short', 'around': 'hips', 'n': 12, 'bones': 3, 'parent': 'Hips', 'top': 0.02}},
    'vtunic_src': {'sex': ['man'], 'mhclo': 'rehmanpolanski_viking_tunic/rehmanpolanski_viking_tunic.mhclo', 'only_source': True},
    'shirt': {'sex': ['man'], 'derive': {'from': 'vtunic_src', 'keep': ['tunic'], 'lengthen': 0.3}, 'fabric': 'twill', 'layer': 'tunic', 'skirt': {'top': 0.9, 'hem': 0.75}, 'chains': {'set': 'short', 'around': 'hips', 'n': 12, 'bones': 3, 'parent': 'Hips', 'top': 0.02}},
    'belt': {'sex': ['man'], 'derive': {'from': 'vtunic_src', 'keep': ['belt']}, 'fabric': 'leather', 'layer': 'belt', 'map': 'color'},
    'hose': {'sex': ['man'], 'mhclo': 'rehmanpolanski_viking_pants/rehmanpolanski_viking_pants.mhclo', 'fabric': 'twill', 'layer': 'leg', 'map': 'detail'},
    'boots': {'sex': ['man'], 'mhclo': 'rehmanpolanski_viking_boots/rehmanpolanski_viking_boots.mhclo', 'fabric': 'leather', 'layer': 'shoe', 'map': 'color'},
    'shoes': {'sex': ['man', 'woman'], 'mhclo': 'punkduck_medieval_boots/punkduck_medieval_boots.mhclo', 'fabric': 'leather', 'layer': 'shoe', 'map': 'color'},
    # Modelled here (drape.py): a Lombard cloak of fulled wool fastened at
    # the right shoulder, to the calf; a woman's shawl round the shoulders.
    'cloak': {'sex': ['man'], 'drape': {'from': 165, 'to': 375, 'length': 1.05, 'over': ['shirt'], 'frames': 1, 'gap': 0.03, 'folds': 0.05, 'nfolds': 13}, 'fabric': 'felt', 'layer': 'over', 'depth': 80, 'skirt': {'top': 0.5, 'hem': 0.3}, 'chains': {'set': 'cape', 'around': 'neck', 'n': 13, 'bones': 6, 'arc': (165, 375), 'parent': 'Spine2', 'top': -0.08}},
    'gown': {'sex': ['woman'], 'mhclo': 'punkduck_medieval_dress/punkduck_medieval_dress.mhclo', 'fabric': 'twill', 'layer': 'tunic', 'nrm': 0.4, 'skirt': {'top': 0.85, 'hem': 0.55}, 'chains': {'set': 'long', 'around': 'hips', 'n': 12, 'bones': 5, 'parent': 'Hips', 'top': 0.0}},
    'veil': {'sex': ['woman'], 'mhclo': 'elvs_charity_veil1/elvs_charity_veil1.mhclo', 'fabric': 'linen', 'layer': 'head', 'relax': 30},
}

# Outfits: what each kind of person wears (the game picks dyes and props).
OUTFITS = {
    'monk': {'sex': 'man', 'garments': ['robe', 'rope', 'cowl', 'shoes']},
    # Bare-headed: the game wears it only on the elderly body (close-cropped grey: no tonsure is painted in v2).
    'monkBare': {'sex': 'man', 'garments': ['robe', 'rope', 'shoes']},
    'peasantHood': {'sex': 'man', 'garments': ['tunic', 'hood', 'hose', 'boots']},
    'peasantCloak': {'sex': 'man', 'garments': ['shirt', 'belt', 'cloak', 'hose', 'boots']},
    'soldier': {'sex': 'man', 'garments': ['shirt', 'belt', 'hose', 'boots']},
    'soldierCloak': {'sex': 'man', 'garments': ['shirt', 'belt', 'cloak', 'hose', 'boots']},
    # The long tunic of clergy, merchants and strangers, and the same under a mantle (src/npc/population.ts).
    'robe': {'sex': 'man', 'garments': ['longrobe', 'belt', 'shoes']},
    'robeCloak': {'sex': 'man', 'garments': ['longrobe', 'belt', 'cloak', 'shoes']},
    'woman': {'sex': 'woman', 'garments': ['gown', 'veil', 'shoes']},
    # (A shawl draped here read as a stiff sheet: the woman's veil falls over her shoulders instead.)
    'womanShawl': {'sex': 'woman', 'garments': ['gown', 'veil', 'shoes']},
}
