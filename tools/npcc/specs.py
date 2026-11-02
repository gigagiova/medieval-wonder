"""Track C characters: source (Sketchfab uid), height, and how to rig each one.

pose 'T': arms are measured on the mesh. Otherwise `marks` gives the arm joints by hand
(metres, Blender axes: +X = the character's left, -Y = front, Z up, feet on z=0), read off
front and side renders; the right side mirrors the left unless given.
"""
SPECS = {
    # Medieval Villager Render (Meshy AI, CC BY 4.0) — hooded tunic, hose, boots
    'c_villager': dict(uid='b8da7ee47b2541dd80e895b0e55da528', sex='man', height=1.70, pose='T', tris=12000),
    # Medieval Man (EmanuelP, CC BY 4.0) — belted tunic, trousers, boots
    'c_man': dict(uid='07794757add64fda8dd7d7cc35dd7040', sex='man', height=1.72, pose='T', tris=10000),
    # Turk villager T-Pose (Meshy AI, CC BY 4.0) — long coat over tunic: an Eastern trader
    'c_eastern': dict(uid='fa4c963b123243b482725263ecbd5436', sex='man', height=1.70, pose='T', tris=12000, skirt=True),
    # Saxon Warrior - T pose (CC BY 4.0) — tunic, sash, wrapped hose, helmet; shield and sword dropped
    'c_soldier': dict(uid='95bf19fa8edd42b99ec2be9f1dce4b11', sex='man', height=1.80, pose='T', tris=14000,
                      drop=('Shield', 'Sword_07', 'Teeth', 'Dagger_06', 'Chain_mail'), boost={'Head': 8, 'Hands': 2}),
    # Medieval woman figure (mikurban, CC BY 4.0) — gown, apron, kerchief
    'c_woman': dict(uid='3b6553e6af11465e97bbd8b4fdfee91c', sex='woman', height=1.60, pose='down', tris=14000, skirt=True, boost={'woman_body': 2, 'headkerchief': 1.5},
                    marks=dict(LeftArm=(0.165, 0.04, 1.28), LeftForeArm=(0.19, 0.06, 0.98), LeftHand=(0.175, 0.01, 0.85), LeftHandTip=(0.15, -0.03, 0.71),
                               RightArm=(-0.165, 0.04, 1.28), RightForeArm=(-0.20, 0.04, 0.99), RightHand=(-0.15, -0.06, 0.93), RightHandTip=(-0.06, -0.10, 0.85))),
    # Nun (CC BY 4.0) — black habit, veil, cord
    'c_nun': dict(uid='b1ea069709ca42f9ba9f4683af751d79', sex='woman', height=1.62, pose='down', tris=8000, skirt=True,
                  marks=dict(LeftArm=(0.16, -0.02, 1.29), LeftForeArm=(0.24, -0.05, 1.03), LeftHand=(0.28, -0.08, 0.88), LeftHandTip=(0.30, -0.10, 0.78))),
    # Friar in Brown Habit (Meshy AI, CC BY 4.0) — hooded habit, cord
    'c_friar': dict(uid='73b97f54bf5e485f827adf92f61a96d5', sex='man', height=1.70, pose='free', tris=12000, skirt=True, shift=(-0.06, 0, 0),
                    marks=dict(RightArm=(-0.17, 0.0, 1.36), RightForeArm=(-0.35, -0.15, 1.13), RightHand=(-0.43, -0.27, 1.03), RightHandTip=(-0.58, -0.32, 0.99),
                               LeftArm=(0.16, 0.0, 1.36), LeftForeArm=(0.17, -0.02, 1.12), LeftHand=(0.0, -0.15, 1.07), LeftHandTip=(-0.09, -0.17, 1.06))),
}
