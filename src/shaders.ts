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
  fogC += vec3(0.10,0.13,0.18) * (pow(md, 6.0)*0.5 + pow(md, 60.0)) * (1.0 - uUnder);
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
  scat *= 0.022 * mix(0.5, 1.5, n);
  return mix(col, fogC, fogAmt) + scat;
}
`;

// Procedural surface library. MAT is a per-material #define.
export const surfaceGLSL = /* glsl */ `
struct Surf { vec3 alb; float rough; float h; vec3 emi; };

float groundY(vec3 p){ return p.y < -2.5 ? -7.0 : 0.0; }
vec2 projUV(vec3 p, vec3 n){
  vec3 an=abs(n);
  if(an.y>an.x && an.y>an.z) return p.xz;
  if(an.x>an.z) return p.zy;
  return p.xy;
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
  o.h = mortar*(0.5+0.3*g) - pits*0.15 + sqrt(clamp(edge/0.07,0.,1.))*0.4;
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
  s.rough = mix(s.rough, 0.4, grime*0.7);
}

Surf surface(vec3 p, vec3 n){
  Surf s; s.emi = vec3(0.); s.rough = 0.9; s.h = 0.;
#if MAT == 0
  s = ashlar(p, n, vec2(0.62,0.31), vec3(0.26,0.23,0.19), 0.85); weather(s,p,n);
#elif MAT == 9
  s = ashlar(p, n, vec2(1.05,0.5), vec3(0.2,0.2,0.19), 0.9); weather(s,p,n);
#elif MAT == 10
  s = ashlar(p, n, vec2(1.0,0.75), vec3(0.16,0.15,0.14), 0.55);
#elif MAT == 1
  vec2 uv = p.xz;
  float r = length(uv);
  vec3 vor = voronoi(uv*2.3);
  float edge = vor.y - vor.x;
  float cob = smoothstep(0.03,0.2,edge);
  vec3 cobC = vec3(0.13,0.12,0.11)*(0.55+0.8*vor.z);
  float mud = smoothstep(0.5,0.7,fbm(vec3(uv*0.12,2.)));
  float inTown = 1.0 - smoothstep(66., 72., r);
  float road = (1.0 - smoothstep(2.5,4.5,abs(uv.x + sin(uv.y*0.05)*2.))) * step(70., uv.y);
  vec3 mudC = vec3(0.075,0.055,0.04)*(0.6+0.7*fbm(vec3(uv*2.,5.)));
  vec3 grassC = vec3(0.04,0.05,0.025)*(0.5+0.9*fbm(vec3(uv*1.3,8.)));
  vec3 outC = mix(grassC, mudC, max(road, smoothstep(0.45,0.7,fbm(vec3(uv*0.3,1.)))));
  vec3 townC = mix(cobC*mix(0.25,1.,cob), mudC, mud);
  s.alb = mix(outC, townC, inTown);
  float hOut = fbm(vec3(uv*3.,0.));
  float hTown = mix(cob*0.9 - vor.x*0.3, hOut*0.4, mud);
  s.h = mix(hOut*0.6, hTown, inTown);
  float pud = smoothstep(0.6,0.64,fbm(vec3(uv*0.22,4.)) + (1.-inTown)*0.05);
  s.alb *= 1.-pud*0.55;
  s.rough = mix(mix(0.92,0.75,inTown*cob), 0.05, pud);
  s.h *= 1.-pud;
#elif MAT == 2
  vec2 uv = projUV(p,n);
  float g = fbm(vec3(uv*1.2,0.)); float g2 = fbm(vec3(uv*9.,3.));
  vec3 c = vec3(0.4,0.35,0.27)*(0.7+0.4*g)*(0.88+0.24*g2);
  float patchM = smoothstep(0.64,0.67,fbm(vec3(uv*0.5,9.)));
  Surf st = ashlar(p,n,vec2(0.4,0.2),vec3(0.2,0.15,0.11),0.9);
  s.alb = mix(c, st.alb, patchM);
  s.h = mix(0.6+g2*0.15, st.h*0.5, patchM);
  s.rough = 0.95;
  weather(s,p,n);
#elif MAT == 3
  vec2 uv = projUV(p,n);
  float id = floor(uv.x/0.22);
  float fx = fract(uv.x/0.22);
  float grain = vnoise(vec3(uv.x*55., uv.y*1.5, id*3.));
  float gap = smoothstep(0.0,0.06,fx)*smoothstep(1.0,0.94,fx);
  s.alb = vec3(0.1,0.06,0.032)*(0.55+0.7*grain)*(0.75+0.5*hash12(vec2(id,1.)))*mix(0.3,1.,gap);
  s.h = gap*0.6 + grain*0.15; s.rough = 0.8;
#elif MAT == 4
  vec2 uv = projUV(p,n);
  vec3 vor = voronoi(uv*vec2(3.5,6.));
  float e = smoothstep(0.02,0.12,vor.y-vor.x);
  s.alb = vec3(0.065,0.05,0.045)*(0.5+0.9*vor.z)*mix(0.3,1.,e);
  float moss = smoothstep(0.5,0.75,fbm(p*0.6));
  s.alb = mix(s.alb, vec3(0.04,0.05,0.02), moss*0.6);
  s.h = e*0.5 + vor.x*0.4; s.rough = 0.75;
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
  s.alb = vec3(0.42,0.37,0.27)*(0.6+0.4*g); s.h = g*0.3; s.rough = 0.6;
#elif MAT == 7
  s.alb = vec3(0.025,0.022,0.02)*(0.7+0.6*fbm(p*10.)); s.rough = 0.45;
#elif MAT == 8
  vec2 uv = projUV(p,n)*7.;
  float d1 = abs(fract(uv.x+uv.y)-.5), d2 = abs(fract(uv.x-uv.y)-.5);
  float lead = smoothstep(0.0,0.07,min(d1,d2));
  float seed = hash13(floor(p*0.5));
  float fl = 0.75 + 0.25*vnoise(vec3(uTime*2.5+seed*40., seed, 0.));
  vec3 warm = mix(vec3(1.0,0.38,0.08), vec3(1.0,0.6,0.25), seed);
  s.alb = vec3(0.02);
  s.emi = warm * lead * fl * 2.2 * (0.7+0.6*vnoise(vec3(uv*0.6,1.)));
  s.rough = 0.3;
#elif MAT == 11
  float g = fbm(p*vec3(25.,6.,25.));
  s.alb = vec3(0.05,0.035,0.025)*(0.6+0.6*g); s.h = g*0.2; s.rough = 1.0;
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
