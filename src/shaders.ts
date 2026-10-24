// Shared GLSL: noise, procedural surfaces, and the atmosphere (height fog +
// analytic lamp in-scattering) that every material in the world runs through.

export const NLAMP = 10;

export const noiseGLSL = /* glsl */ `
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float vnoise2(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s/0.9375; }
// x: F1, y: F2, z: cell hash
vec3 voronoi(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p); float f1=8., f2=8., id=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)); vec2 o=hash22(i+g)*.85+.075;
    float d=length(g+o-f);
    if(d<f1){ f2=f1; f1=d; id=hash12(i+g); } else if(d<f2){ f2=d; }
  }
  return vec3(f1,f2,id);
}
`;

export const atmosGLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uLampPos[${NLAMP}];
uniform vec3 uLampCol[${NLAMP}];
uniform vec3 uFogCol;
uniform float uUnder;
uniform vec3 uMoonDir;

vec3 applyAtmos(vec3 col, vec3 wpos){
  vec3 ro = cameraPosition;
  vec3 rd = wpos - ro; float L = max(length(rd), 1e-3); rd /= L;
  float dens = mix(0.045, 0.075, uUnder);
  float b = mix(0.09, 0.0, uUnder);
  float ground = mix(0.0, -7.0, uUnder);
  float od;
  float k = b * rd.y * L;
  if (abs(k) > 1e-3) od = dens * exp(-b*(ro.y-ground)) * (1.0 - exp(-k)) / (b*rd.y);
  else od = dens * exp(-b*(ro.y-ground)) * L;
  vec3 mp = ro + rd * min(L, 25.0) * 0.6;
  float n = fbm(mp*0.07 + vec3(uTime*0.04, -uTime*0.01, uTime*0.025));
  od *= mix(0.45, 1.6, n);
  float fogAmt = 1.0 - exp(-od);
  vec3 fogC = mix(uFogCol, vec3(0.012,0.009,0.007), uUnder);
  float md = max(dot(rd, uMoonDir), 0.0);
  // Dusk: the fog is a touch brighter where the light is going. Grey, never warm.
  fogC *= 1.0 + 0.12 * pow(md, 3.0) * (1.0 - uUnder);
  // Closed-form integral of 1/(h^2+t^2) along the view ray for every lamp:
  // cheap volumetric halos that actually wrap around geometry edges.
  vec3 scat = vec3(0.0);
  for (int i=0;i<${NLAMP};i++){
    vec3 lp = uLampPos[i] - ro;
    float t0 = dot(lp, rd);
    float h = max(length(lp - rd*t0), 0.35);
    float a = (atan((L - t0)/h) - atan(-t0/h)) / h;
    scat += uLampCol[i] * a * exp(-dens*0.8*clamp(t0, 0.0, L));
  }
  scat *= mix(0.011, 0.022, uUnder) * mix(0.5, 1.5, n);
  return mix(col, fogC, fogAmt) + scat;
}
`;

// Procedural surface library. MAT is a per-material #define.
export const surfaceGLSL = /* glsl */ `
struct Surf { vec3 alb; float rough; float h; vec3 emi; };

uniform sampler2D uTown; // R main lane, G street, B gutter, A terrain height
vec4 townAt(vec2 xz){ return texture2D(uTown, (xz + 100.)/200.); }
float groundY(vec3 p){ return p.y < -2.5 ? -7.0 : townAt(p.xz).a*4. - 1.5; }
vec2 projUV(vec3 p, vec3 n){
  vec3 an=abs(n);
  if(an.y>an.x && an.y>an.z) return p.xz;
  if(an.x>an.z) return p.zy;
  return p.xy;
}

// ---- Relief: per-material height fields (1 = proud surface, 0 = deepest) ----
vec3 gN = vec3(0.,1.,0.);   // surface normal, for direction-aware patterns (roof tiles)
float gRoad = 0.;           // 1 on the old Roman paving

float hAshlar(vec2 uv, vec2 sz){
  vec2 s = uv/sz;
  float row = floor(s.y);
  s.x += hash12(vec2(row,7.))*0.6;
  vec2 id = floor(s); vec2 f = fract(s);
  float rnd = hash12(id);
  vec2 e = min(f,1.-f)*sz;
  float edge = min(e.x,e.y) + (vnoise(vec3(uv*7.,1.))-.5)*0.035;
  // Each block is pillowed, chipped and sits proud by a different amount.
  float pillow = sqrt(clamp(edge/(0.05+0.04*rnd),0.,1.));
  float face = 0.72 + 0.28*rnd - 0.18*vnoise(vec3(uv*4.,rnd*9.)) - 0.1*vnoise(vec3(uv*11.,rnd*3.));
  return clamp(pillow*face, 0., 1.);
}
float hCobble(vec2 uv){
  vec3 v = voronoi(uv*2.3);
  float e = v.y - v.x;
  return smoothstep(0.0, 0.42, e) * (0.65 + 0.35*v.z);
}
float hPlank(vec2 uv){
  float id = floor(uv.x/0.22), fx = fract(uv.x/0.22);
  float gap = smoothstep(0.0,0.08,fx)*smoothstep(1.0,0.92,fx);
  float warp = 0.15*sin(fx*3.14159) * (0.5+hash12(vec2(id,4.)));
  float dents = vnoise(vec3(uv.x*9., uv.y*2.5, id)) * 0.35 + vnoise(vec3(uv*vec2(20.,6.), id))*0.15;
  return gap * (0.6 + warp - dents + 0.25);
}
float hSlate(vec2 uv){
  vec3 v = voronoi(uv*vec2(3.5,6.));
  return smoothstep(0.0,0.3,v.y-v.x)*(0.55+0.45*v.z);
}
float hRock(vec2 uv){
  return vnoise(vec3(uv*1.7,2.))*0.55 + vnoise(vec3(uv*4.3,5.))*0.3 + vnoise(vec3(uv*13.,9.))*0.15;
}
float hPlaster(vec2 uv){
  // Hand-trowelled daub over an uneven wall: lumps, ridges and a few gouges.
  float lumps = vnoise(vec3(uv*1.6,1.))*0.45 + vnoise(vec3(uv*4.5,4.))*0.3 + vnoise(vec3(uv*13.,7.))*0.12;
  float gouge = smoothstep(0.8,0.9,vnoise(vec3(uv*vec2(4.,9.),9.)));
  return clamp(0.15 + lumps - gouge*0.15, 0., 1.);
}

// 0 = mud / yard, 1 = river-cobble alley, 2 = surviving Roman basalt paving.
float roadMask(vec2 xz){
  vec4 t = townAt(xz);
  if (t.g < 0.5) return 0.;
  float patchy = smoothstep(0.45, 0.6, vnoise(vec3(xz*0.22, 4.)));
  return (t.r > 0.35 && patchy > 0.5) ? 2. : 1.;
}
// Basoli: big polygonal basalt slabs of the Roman street, worn and sunken.
float hBasoli(vec2 uv){
  vec3 v = voronoi(uv*1.25);
  float e = v.y - v.x;
  return smoothstep(0.0, 0.16, e) * (0.75 + 0.25*v.z) - 0.12*vnoise(vec3(uv*3.,v.z*9.));
}
// Trodden mud with scattered field stones.
float hMud(vec2 uv){
  vec3 v = voronoi(uv*1.6);
  float stone = step(0.72, v.z) * smoothstep(0.32, 0.12, v.x);
  return 0.35 + 0.2*vnoise(vec3(uv*2.,1.)) + 0.1*vnoise(vec3(uv*9.,2.)) + stone*0.45;
}
// Roman brick bands alternating with courses of squared tuff (opus mixtum).
float hBrick(vec2 uv){
  float band = mod(uv.y, 1.25);
  if (band < 0.55) {
    // brick courses: 4.5 cm bricks, thick 2.5 cm mortar
    float row = floor(uv.y/0.07);
    float fy = fract(uv.y/0.07);
    float x = uv.x/0.42 + hash12(vec2(row,3.))*0.5;
    float fx = fract(x);
    float m = smoothstep(0.0,0.2,fy)*smoothstep(1.0,0.62,fy) * smoothstep(0.0,0.04,fx)*smoothstep(1.0,0.96,fx);
    float worn = hash12(vec2(floor(x),row));
    return m*(0.75+0.25*worn) - 0.15*vnoise(vec3(uv*20.,row));
  }
  return hAshlar(uv + vec2(0.,0.2), vec2(0.3,0.11))*0.95;
}
// River cobbles laid in mortar, every third course in herringbone (opus spicatum).
float hRubble(vec2 uv){
  float course = floor(uv.y/0.16);
  vec2 q = uv;
  if (mod(course,3.) == 1.) {
    float s = mod(floor(uv.x/0.12),2.)*2.-1.;
    q = vec2(uv.x + s*(fract(uv.y/0.16)-0.5)*0.12, uv.y);
    vec3 v = voronoi(q*vec2(9.,5.));
    return smoothstep(0.0,0.3,v.y-v.x)*(0.7+0.3*v.z);
  }
  vec3 v = voronoi(vec2(uv.x*5.5, uv.y*6.25 + course*0.37));
  return smoothstep(0.02,0.38,v.y-v.x)*(0.6+0.4*v.z);
}
// Coppi: half-round terracotta tiles running down the slope, canal and cover.
float hCoppi(vec2 uv){
  vec2 nh = gN.xz; float l = length(nh);
  nh = l > 0.05 ? nh/l : vec2(0.,1.);
  float along = dot(uv, nh), across = dot(uv, vec2(-nh.y, nh.x));
  float t = across/0.17; float ci = floor(t); float f = fract(t);
  float prof = sqrt(max(0., 1. - (2.*f-1.)*(2.*f-1.)));
  float cover = mod(ci,2.);
  float rowf = fract(along/0.42 + hash12(vec2(ci,5.))*0.25);
  float lip = smoothstep(0.82,1.0,rowf)*0.18;
  float h = cover > 0.5 ? 0.45 + 0.55*prof : 0.35*(1.-prof);
  float broken = step(0.93, hash12(vec2(ci, floor(along/0.42))));
  return h + lip - broken*0.3;
}
// Weathered travertine / marble spolia: pitted, eroded, streaked.
float hMarble(vec2 uv){
  float pits = smoothstep(0.55,0.75,vnoise(vec3(uv*vec2(9.,26.),1.)));
  return 0.8 - pits*0.6 + 0.2*vnoise(vec3(uv*3.,4.));
}

Surf ashlar(vec3 p, vec3 n, vec2 sz, vec3 base, float rough){
  vec2 uv = projUV(p,n);
  vec2 s = uv/sz;
  float row = floor(s.y);
  s.x += hash12(vec2(row,7.))*0.6;
  vec2 id = floor(s); vec2 f = fract(s);
  float rnd = hash12(id);
  vec2 e = min(f,1.-f)*sz;
  float edge = min(e.x,e.y) + (vnoise(vec3(uv*7.,1.))-.5)*0.035;
  float mortar = smoothstep(0.006,0.035,edge);
  float g = fbm(vec3(uv*3.,rnd*13.));
  float pits = smoothstep(0.62,0.72,vnoise(vec3(uv*16.,rnd*7.)));
  vec3 tint = mix(vec3(1.), vec3(1.1,1.0,0.82), hash12(id+3.1));
  Surf o;
  o.alb = base*tint*(0.65+0.6*rnd)*(0.7+0.6*g)*(1.-pits*0.35);
  o.alb = mix(base*0.3, o.alb, mortar);
  o.h = hAshlar(uv, sz)*1.5 - pits*0.15 + g*0.2;
  o.rough = rough; o.emi = vec3(0.);
  return o;
}

void weather(inout Surf s, vec3 p, vec3 n){
  float y = p.y - groundY(p);
  float gn = fbm(p*0.45);
  float grime = 1.0 - smoothstep(0.0, 1.5+gn*3., y);
  s.alb *= mix(1.0, 0.4, grime);
  float streak = vnoise(vec3((p.x+p.z)*2.5, p.y*0.12, 0.));
  s.alb *= 0.75+0.45*streak;
  float under = step(p.y, -2.5);
  float moss = smoothstep(0.55,0.72,fbm(p*0.7+3.)) * (1.-smoothstep(0.,2.5,y));
  moss += smoothstep(0.5,0.95,n.y)*smoothstep(0.4,0.6,fbm(p*1.3));
  s.alb = mix(s.alb, vec3(0.035,0.05,0.018), clamp(moss,0.,1.)*0.8*(1.-under));
  s.rough = mix(s.rough, 0.7, grime*0.5);
}

float pomH(vec2 uv){
#if MAT == 0
  return hAshlar(uv, vec2(0.62,0.31));
#elif MAT == 9
  return hAshlar(uv, vec2(1.05,0.5));
#elif MAT == 10
  return hAshlar(uv, vec2(1.0,0.75));
#elif MAT == 1
  return gRoad > 1.5 ? hBasoli(uv) : gRoad > 0.5 ? hCobble(uv) : hMud(uv);
#elif MAT == 3
  return hPlank(uv);
#elif MAT == 4
  return hCoppi(uv);
#elif MAT == 12
  return hBrick(uv);
#elif MAT == 13
  return hRubble(uv);
#elif MAT == 14
  return hMarble(uv);
#elif MAT == 5
  return hRock(uv);
#elif MAT == 2
  return hPlaster(uv);
#else
  return 1.0;
#endif
}

#if MAT == 0 || MAT == 9
  #define POM_DEPTH 0.05
#elif MAT == 10
  #define POM_DEPTH 0.025
#elif MAT == 1
  #define POM_DEPTH 0.07
#elif MAT == 3
  #define POM_DEPTH 0.03
#elif MAT == 4
  #define POM_DEPTH 0.07
#elif MAT == 5
  #define POM_DEPTH 0.12
#elif MAT == 2
  #define POM_DEPTH 0.05
#elif MAT == 12
  #define POM_DEPTH 0.025
#elif MAT == 13
  #define POM_DEPTH 0.04
#elif MAT == 14
  #define POM_DEPTH 0.03
#endif

// Parallax occlusion: march the view ray into the height field in the
// dominant-axis plane and return the world point it actually hits.
vec3 parallax(vec3 p, vec3 n, out float occl){
  occl = 1.0;
#ifdef POM_DEPTH
  float dist = length(cameraPosition - p);
  float fade = 1.0 - smoothstep(9.0, 22.0, dist);
  if (fade <= 0.0) return p;
  float depth = POM_DEPTH * fade;
  gN = n;
  #if MAT == 1
    gRoad = p.y > -2.5 ? roadMask(p.xz) : 0.;
    depth *= gRoad > 0.5 ? 1.0 : 0.6;
  #endif
  vec3 an = abs(n); vec3 U, V, N;
  // On curved surfaces the projection axis flips; fade the relief out near
  // those flips so no seams appear.
  float hi = max(an.x, max(an.y, an.z)), lo3 = min(an.x, min(an.y, an.z));
  float mid = an.x + an.y + an.z - hi - lo3;
  depth *= smoothstep(0.05, 0.25, hi - mid);
  if (an.y>an.x && an.y>an.z){ U=vec3(1,0,0); V=vec3(0,0,1); N=vec3(0,sign(n.y),0); }
  else if (an.x>an.z){ U=vec3(0,0,1); V=vec3(0,1,0); N=vec3(sign(n.x),0,0); }
  else { U=vec3(1,0,0); V=vec3(0,1,0); N=vec3(0,0,sign(n.z)); }
  vec3 vd = normalize(cameraPosition - p);
  vec3 vt = vec3(dot(vd,U), dot(vd,V), max(dot(vd,N), 0.2));
  vec2 uv = vec2(dot(p,U), dot(p,V));
  const int STEPS = 20;
  float layer = 1.0/float(STEPS);
  vec2 duv = -vt.xy/vt.z * depth * layer;
  float cur = 1.0;
  vec2 cuv = uv;
  float h = pomH(cuv);
  float ph = h, pl = cur;
  for (int i=0;i<STEPS;i++){
    if (h >= cur) break;
    ph = h; pl = cur;
    cuv += duv; cur -= layer;
    h = pomH(cuv);
  }
  float a = h - cur, b = ph - pl;
  float w = a/(a - b + 1e-5);
  vec2 fuv = mix(cuv, cuv - duv, clamp(w,0.,1.));
  vec2 off = fuv - uv;
  float hit = mix(cur, pl, clamp(w,0.,1.));
  // Crevices are darker: cheap cavity occlusion from how deep we hit.
  occl = mix(1.0, 0.35 + 0.65*hit, fade);
  return p + U*off.x + V*off.y - N*(1.0-hit)*depth;
#else
  return p;
#endif
}

Surf surface(vec3 p, vec3 n){
  Surf s; s.emi = vec3(0.); s.rough = 0.9; s.h = 0.;
#if MAT == 0
  s = ashlar(p, n, vec2(0.62,0.31), vec3(0.26,0.23,0.19), 0.93); weather(s,p,n);
#elif MAT == 9
  s = ashlar(p, n, vec2(1.05,0.5), vec3(0.2,0.2,0.19), 0.95); weather(s,p,n);
#elif MAT == 10
  s = ashlar(p, n, vec2(1.0,0.75), vec3(0.16,0.15,0.14), 0.78);
#elif MAT == 1
  vec2 uv = p.xz;
  vec4 tw = townAt(uv);
  float rm = p.y > -2.5 ? roadMask(uv) : 0.;
  float inTown = smoothstep(0.0, 0.1, tw.g + step(length(uv), 80.));
  // Basalt basoli: dark, big, sunken, lifted by roots.
  vec3 vb = voronoi(uv*1.25);
  vec3 basC = vec3(0.075,0.075,0.08)*(0.6+0.6*vb.z)*mix(0.25,1.,smoothstep(0.0,0.1,vb.y-vb.x))*(0.8+0.4*fbm(vec3(uv*4.,vb.z*7.)));
  // River cobbles, set in earth, mossy between.
  vec3 vc = voronoi(uv*2.3);
  float ce = smoothstep(0.03,0.2,vc.y-vc.x);
  vec3 cobC = mix(vec3(0.12,0.11,0.1), vec3(0.17,0.15,0.12), vc.z)*(0.6+0.5*hash12(floor(uv*2.3)+vc.z));
  cobC = mix(vec3(0.045,0.05,0.03), cobC, ce);
  // Mud, straw, weeds in yards and outside the walls.
  vec3 vm = voronoi(uv*1.6);
  float stone = step(0.72, vm.z) * smoothstep(0.32,0.12,vm.x);
  vec3 mudC = vec3(0.1,0.078,0.055)*(0.55+0.8*fbm(vec3(uv*1.7,5.)));
  mudC = mix(mudC, vec3(0.15,0.14,0.12)*(0.6+0.6*vm.z), stone);
  float weeds = smoothstep(0.45,0.7,fbm(vec3(uv*0.35,8.)));
  vec3 grassC = vec3(0.06,0.07,0.04)*(0.5+0.9*fbm(vec3(uv*2.3,8.)));
  vec3 c = mix(mudC, grassC, weeds*0.8);
  c = rm > 1.5 ? basC : rm > 0.5 ? cobC : c;
  // Dirt drifted against the walls, the alley worn smooth in the middle.
  s.alb = c;
  s.h = (rm > 1.5 ? hBasoli(uv) : rm > 0.5 ? hCobble(uv) : hMud(uv))*1.5;
  float gut = tw.b * step(0.5, tw.g);
  s.alb *= 1. - gut*0.45;
  float pud = smoothstep(0.66,0.7,fbm(vec3(uv*0.22,4.))) * (1.-step(0.5,rm)*0.5) + gut*0.5;
  pud = clamp(pud,0.,1.);
  s.alb *= 1.-pud*0.4;
  s.rough = mix(rm > 0.5 ? 0.86 : 0.96, 0.4, pud);
  s.h *= 1.-pud*0.7;
#elif MAT == 2
  vec2 uv = projUV(p,n);
  float g = fbm(vec3(uv*1.2,0.)); float g2 = fbm(vec3(uv*9.,3.));
  vec3 c = vec3(0.4,0.35,0.27)*(0.7+0.4*g)*(0.88+0.24*g2);
  float patchM = smoothstep(0.64,0.67,fbm(vec3(uv*0.5,9.)));
  Surf st = ashlar(p,n,vec2(0.4,0.2),vec3(0.2,0.15,0.11),0.9);
  s.alb = mix(c, st.alb, patchM);
  float hp = hPlaster(uv);
  s.alb *= 0.75 + 0.4*hp;
  s.h = mix(hp*1.5, st.h*0.5, patchM);
  s.rough = 0.95;
  weather(s,p,n);
#elif MAT == 3
  vec2 uv = projUV(p,n);
  float id = floor(uv.x/0.22);
  float fx = fract(uv.x/0.22);
  float grain = vnoise(vec3(uv.x*55., uv.y*1.5, id*3.));
  float gap = smoothstep(0.0,0.06,fx)*smoothstep(1.0,0.94,fx);
  s.alb = vec3(0.1,0.06,0.032)*(0.55+0.7*grain)*(0.75+0.5*hash12(vec2(id,1.)))*mix(0.3,1.,gap);
  s.h = hPlank(uv)*1.5 + grain*0.15; s.rough = 0.92;
#elif MAT == 4
  // Coppi: sun-faded terracotta, each tile a slightly different firing.
  vec2 uv = projUV(p,n);
  gN = n;
  float hc = hCoppi(uv);
  vec2 nh = n.xz; float l = length(nh); nh = l > 0.05 ? nh/l : vec2(0.,1.);
  float ci = floor(dot(uv, vec2(-nh.y,nh.x))/0.17), ri = floor(dot(uv,nh)/0.42);
  float tile = hash12(vec2(ci,ri));
  s.alb = mix(vec3(0.16,0.07,0.04), vec3(0.2,0.12,0.07), tile)*(0.55+0.5*hc)*(0.8+0.3*fbm(vec3(uv*5.,tile)));
  float lichen = smoothstep(0.55,0.75,fbm(p*0.9+2.));
  s.alb = mix(s.alb, vec3(0.09,0.09,0.06), lichen*0.6);
  s.h = hc*1.5; s.rough = 0.88;
#elif MAT == 5
  float g = fbm(p*1.6);
  float strata = sin(p.y*9. + g*5.)*0.5+0.5;
  float marks = vnoise(p*vec3(7.,26.,7.));
  s.alb = vec3(0.17,0.13,0.08)*(0.55+0.6*g)*(0.85+0.3*strata);
  float niter = smoothstep(0.62,0.7,fbm(p*0.9+5.));
  s.alb = mix(s.alb, vec3(0.24,0.23,0.2), niter*0.6);
  s.h = g*0.7 + marks*0.15 + strata*0.1; s.rough = 0.85;
#elif MAT == 6
  float g = fbm(p*18.);
  s.alb = vec3(0.42,0.37,0.27)*(0.6+0.4*g); s.h = g*0.3; s.rough = 0.8;
#elif MAT == 7
  s.alb = vec3(0.025,0.022,0.02)*(0.7+0.6*fbm(p*10.)); s.rough = 0.75;
#elif MAT == 8
  // Closed shutters: firelight leaks through the cracks between boards.
  vec2 uv = projUV(p,n);
  float id = floor(uv.x/0.12); float fx = fract(uv.x/0.12);
  float crack = (1.-smoothstep(0.0,0.08,fx)) + (1.-smoothstep(1.0,0.92,fx));
  crack *= 0.6 + 0.4*vnoise(vec3(uv*vec2(3.,9.), id));
  float seed = hash13(floor(p*0.5));
  float fl = 0.7 + 0.3*vnoise(vec3(uTime*2.2+seed*40., seed, 0.));
  float grain = vnoise(vec3(uv.x*50., uv.y*1.5, id));
  s.alb = vec3(0.07,0.045,0.025)*(0.6+0.6*grain);
  s.emi = mix(vec3(1.0,0.35,0.08), vec3(1.0,0.55,0.2), seed) * crack * fl * 3.0;
  s.h = (1.-crack)*0.8; s.rough = 0.9;
#elif MAT == 11
  float g = fbm(p*vec3(25.,6.,25.));
  s.alb = vec3(0.05,0.035,0.025)*(0.6+0.6*g); s.h = g*0.2; s.rough = 1.0;
#elif MAT == 12
  // Opus mixtum: Roman brick bands and tuff courses, reused and patched.
  vec2 uv = projUV(p,n);
  float band = mod(uv.y, 1.25);
  float hb = hBrick(uv);
  float row = floor(uv.y/0.07), bx = floor(uv.x/0.42 + hash12(vec2(row,3.))*0.5);
  vec3 brickC = mix(vec3(0.2,0.085,0.05), vec3(0.24,0.13,0.08), hash12(vec2(bx,row)));
  vec3 tuffC = vec3(0.2,0.18,0.13)*(0.7+0.5*hash12(floor(uv/vec2(0.3,0.11))));
  vec3 mortarC = vec3(0.17,0.16,0.14);
  vec3 c = band < 0.55 ? brickC : tuffC;
  s.alb = mix(mortarC*0.7, c, smoothstep(0.15,0.45,hb))*(0.7+0.5*fbm(vec3(uv*3.,1.)));
  s.h = hb*1.5; s.rough = 0.93;
  weather(s,p,n);
#elif MAT == 13
  // River stones in lime mortar.
  vec2 uv = projUV(p,n);
  float hr = hRubble(uv);
  vec3 v = voronoi(vec2(uv.x*5.5, uv.y*6.25));
  vec3 stoneC = mix(vec3(0.16,0.15,0.14), vec3(0.22,0.19,0.15), v.z)*(0.6+0.6*hash12(floor(uv*7.)));
  s.alb = mix(vec3(0.15,0.14,0.12)*0.8, stoneC, smoothstep(0.1,0.4,hr))*(0.75+0.4*fbm(vec3(uv*2.,3.)));
  s.h = hr*1.5; s.rough = 0.94;
  weather(s,p,n);
#elif MAT == 14
  // Spolia: Roman travertine and marble, pitted and stained black by rain.
  vec2 uv = projUV(p,n);
  float hm = hMarble(uv);
  float veins = smoothstep(0.48,0.5,vnoise(vec3(uv*vec2(2.,7.),3.)))*0.3;
  s.alb = vec3(0.36,0.33,0.27)*(0.7+0.3*fbm(vec3(uv*1.5,2.)))*(0.6+0.4*hm)*(1.-veins);
  float stain = smoothstep(0.35,0.75, vnoise(vec3(uv.x*4., uv.y*0.3, 7.)));
  s.alb *= 1. - stain*0.55;
  s.h = hm*1.5; s.rough = 0.88;
  weather(s,p,n);
#elif MAT == 15
  // Embers in a brazier bowl.
  vec3 v = voronoi(p.xz*14.);
  float hot = smoothstep(0.1,0.0,v.x-0.05) + 0.5*(1.-smoothstep(0.0,0.25,v.y-v.x));
  float fl = 0.6+0.4*vnoise(vec3(p.xz*6., uTime*1.5));
  s.alb = vec3(0.02);
  s.emi = mix(vec3(0.9,0.12,0.02), vec3(1.0,0.45,0.1), v.z) * (1.-hot*0.8) * fl * 3.0;
  s.rough = 1.0;
#elif MAT == 16
  // Horn panes: thin translucent horn, mottled amber, lit from within.
  float m = fbm(p*vec3(30.,8.,30.));
  float fl = 0.75+0.25*vnoise(vec3(uTime*3.+p.x*20., p.z, 0.));
  s.alb = vec3(0.1,0.06,0.02);
  s.emi = vec3(1.0,0.48,0.14)*(0.4+0.8*m)*fl*1.6;
  s.rough = 0.6;
#elif MAT == 17
  // Fired clay (lucernae).
  float g = fbm(p*30.);
  s.alb = vec3(0.24,0.12,0.07)*(0.6+0.5*g); s.h = g*0.4; s.rough = 0.9;
#elif MAT == 18
  // Old bronze, dark with green patina.
  float g = fbm(p*12.);
  s.alb = mix(vec3(0.09,0.06,0.03), vec3(0.06,0.09,0.07), smoothstep(0.4,0.7,g));
  s.rough = 0.7;
#endif
  return s;
}

vec3 bumpNormal(vec3 pos, vec3 nrm, float h){
  vec3 dx = dFdx(pos), dy = dFdy(pos);
  vec3 r1 = cross(dy, nrm), r2 = cross(nrm, dx);
  float det = dot(dx, r1);
  float bx = dFdx(h), by = dFdy(h);
  vec3 grad = sign(det) * (bx*r1 + by*r2);
  return normalize(abs(det)*nrm - grad);
}
`;
