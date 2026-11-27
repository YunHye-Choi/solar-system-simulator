// GLSL sources. SHADER_MAIN(terrainGlsl) builds the scene shader around the shared terrain code.
window.SHADER_VS = `#version 300 es
void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0.,1.); }`;

// A compact FXAA resolve pass smooths terrain silhouettes without rendering the
// expensive ray-marched scene above the device's native pixel count.
window.SHADER_FXAA = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uInvRes;
uniform vec2 uOutRes;
uniform vec2 uSrcScale;
out vec4 oCol;
float lum(vec3 c){ return dot(c,vec3(.299,.587,.114)); }
void main(){
  vec2 uv=gl_FragCoord.xy/uOutRes*uSrcScale;
  vec3 m=texture(uScene,uv).rgb;
  vec3 nw=texture(uScene,uv+vec2(-1.,-1.)*uInvRes).rgb;
  vec3 ne=texture(uScene,uv+vec2( 1.,-1.)*uInvRes).rgb;
  vec3 sw=texture(uScene,uv+vec2(-1., 1.)*uInvRes).rgb;
  vec3 se=texture(uScene,uv+vec2( 1., 1.)*uInvRes).rgb;
  float lm=lum(m), lnw=lum(nw), lne=lum(ne), lsw=lum(sw), lse=lum(se);
  float lo=min(lm,min(min(lnw,lne),min(lsw,lse)));
  float hi=max(lm,max(max(lnw,lne),max(lsw,lse)));
  vec2 dir=vec2(-((lnw+lne)-(lsw+lse)),(lnw+lsw)-(lne+lse));
  float reduce=max((lnw+lne+lsw+lse)*.03125,.0078125);
  float rcp=1./(min(abs(dir.x),abs(dir.y))+reduce);
  dir=clamp(dir*rcp,vec2(-8.),vec2(8.))*uInvRes;
  vec3 a=.5*(texture(uScene,uv+dir*(1./3.-.5)).rgb+texture(uScene,uv+dir*(2./3.-.5)).rgb);
  vec3 b=a*.5+.25*(texture(uScene,uv+dir*-.5).rgb+texture(uScene,uv+dir*.5).rgb);
  float lb=lum(b);
  oCol=vec4((lb<lo||lb>hi)?a:b,1.);
}`;

// ---------------------------------------------------------------- sky cube map
// Rendered once per face. World frame is ecliptic with +Y = ecliptic north.
window.SHADER_SKY = `#version 300 es
precision highp float;
out vec4 oCol;
uniform float uSize;
uniform int uFace;
uniform mat3 uGal;            // columns: toward galactic centre, l=90deg, north galactic pole
uniform vec4 uSt[80];         // xyz direction, w intensity
uniform vec3 uStC[80];
uniform int uNSt;
uniform vec3 uBlob[3];        // LMC, SMC, M31 directions

float h1(vec3 p){ p=fract(p*.3183099+vec3(.1,.2,.3)); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
vec4 h4(vec3 p){ return vec4(h1(p),h1(p+17.3),h1(p+41.7),h1(p+93.1)); }
float vnz(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(h1(i),h1(i+vec3(1,0,0)),f.x),mix(h1(i+vec3(0,1,0)),h1(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h1(i+vec3(0,0,1)),h1(i+vec3(1,0,1)),f.x),mix(h1(i+vec3(0,1,1)),h1(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=a*vnz(p); p=p*2.03+7.1; a*=.5; } return s; }

vec3 starLayer(vec3 d,float sc,float dens,float bright){
  vec3 p=d*sc; vec3 c=floor(p); vec4 h=h4(c);
  if(h.w>dens) return vec3(0.);
  vec3 sp=normalize(c+.5+(h.xyz-.5)*.6);
  vec3 dd=d-sp; float a2=dot(dd,dd);
  float m=h1(c+5.5); float b=bright*(.15+2.2*pow(m,7.));
  float w=.0011+.0006*m;
  float t=h1(c+9.1);
  vec3 col=mix(vec3(1.,.72,.5),vec3(.72,.82,1.),t);
  return col*b*exp(-a2/(w*w));
}

void main(){
  vec2 q=gl_FragCoord.xy/uSize*2.-1.;
  vec3 d;
  if(uFace==0) d=vec3(1.,-q.y,-q.x); else if(uFace==1) d=vec3(-1.,-q.y,q.x);
  else if(uFace==2) d=vec3(q.x,1.,q.y); else if(uFace==3) d=vec3(q.x,-1.,-q.y);
  else if(uFace==4) d=vec3(q.x,-q.y,1.); else d=vec3(-q.x,-q.y,-1.);
  d=normalize(d);
  vec3 g=d*uGal;
  float b=asin(clamp(g.z,-1.,1.)), l=atan(g.y,g.x);
  // Milky Way: disc band seen edge-on from inside, brighter and thicker toward the centre.
  float w=.11+.12*exp(-l*l/.45);
  float band=exp(-pow(b/w,2.))*(.3+.7*exp(-l*l/1.6));
  float bulge=exp(-(l*l/.1+b*b/.035));
  float lane=smoothstep(.42,.68,fbm(d*7.+3.))*exp(-pow(b/(w*.5),2.));
  float cl=.55+.9*fbm(d*15.);
  vec3 col=vec3(.7,.78,1.)*band*.2*cl*(1.-.8*lane)+vec3(1.,.82,.58)*bulge*.3*(1.-.65*lane);
  // Magellanic Clouds and Andromeda.
  col+=vec3(.75,.82,1.)*.16*exp(-pow(acos(clamp(dot(d,uBlob[0]),-1.,1.))/.07,2.))*(.6+.8*fbm(d*40.));
  col+=vec3(.75,.82,1.)*.12*exp(-pow(acos(clamp(dot(d,uBlob[1]),-1.,1.))/.035,2.));
  col+=vec3(1.,.9,.8)*.09*exp(-pow(acos(clamp(dot(d,uBlob[2]),-1.,1.))/.02,2.));
  // Unresolved field stars, denser in the galactic plane.
  float dn=.25+.75*band+.5*bulge;
  col+=starLayer(d,70.,.05+.1*dn,.9);
  col+=starLayer(d,170.,.02+.07*dn,.45);
  col+=starLayer(d,420.,.008+.06*dn,.2);
  // Catalogued bright stars at their real positions.
  for(int i=0;i<uNSt;i++){
    vec3 dd=d-uSt[i].xyz; float a2=dot(dd,dd);
    if(a2<.0009){
      float I=uSt[i].w; float sw=.0013*(1.+.55*sqrt(I));
      col+=uStC[i]*(min(I,3.)*exp(-a2/(sw*sw))+.02*I/(1.+a2/(sw*sw*4.)));
    }
  }
  oCol=vec4(sqrt(clamp(col,0.,1.)),1.);
}`;

// ---------------------------------------------------------------- main scene
window.SHADER_MAIN = (terrainGlsl) => `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler2DArray;
out vec4 oCol;
const int NB=11;
const float PI=3.14159265;
uniform vec2 uRes;
uniform float uTime,uTanF,uPix,uExp;
uniform mat3 uCam;
uniform samplerCube uSky;
uniform sampler2D uEarth;
uniform int uMode,uMapId;
// baked height levels around the camera (tangent-plane coordinates in metres)
uniform sampler2DArray uHT;
uniform int uBake,uBakeOm;
uniform vec4 uLv[8];       // centre u, centre v, texel spacing, valid
uniform vec4 uBk;          // level being baked: centre u, centre v, spacing
uniform vec3 uE1,uE2,uC0,uCamT;
uniform vec4 uBP[NB];      // body centre relative to camera (xyz), radius (w)
uniform vec4 uBC[NB];      // point colour (rgb), light factor (a)
uniform vec4 uRim[NB];     // limb tint (rgb), strength (a)
uniform mat3 uBM[NB];      // body-fixed -> world
uniform float uGlare,uSunVis;
// focus body
uniform int uF,uSteps,uAtmN,uShadow;
uniform mat3 uFM;
uniform float uAlt,uR0,uDisp,uHmax,uSea,uShell,uStepMin,uClr;
uniform vec3 uUp,uCamN;
uniform ivec3 uOI[32];
uniform vec3 uOF[32];
uniform vec3 uBetaR,uBetaM,uBetaA,uMieF,uAmb,uAmbS,uDeckCol;
uniform float uBetaMe,uHR,uHM,uG,uAtmTop,uLight;
uniform vec3 uDeck;        // bottom, top, extinction

vec3 gP,gQ; bool gAbs; vec3 gEm;

float hsh(ivec3 c,int s){
  uint h=uint(c.x)*0x9E3779B1u^uint(c.y)*0x85EBCA77u^uint(c.z)*0xC2B2AE3Du^uint(s)*0x27D4EB2Fu;
  h^=h>>15; h*=0x2C1B3C6Du; h^=h>>12; h*=0x297A2D39u; h^=h>>15;
  return float(h>>8)*(1./16777216.);
}
float OL(int o){ return exp2(29.-float(o)); }
void cell(int o,out ivec3 c,out vec3 f){
  if(gAbs){ vec3 p=gQ*exp2(float(o)-29.); vec3 fl=floor(p); c=ivec3(fl)&255; f=p-fl; }
  else { vec3 p=uOF[o]+gP*exp2(float(o)-29.); vec3 fl=floor(p); c=(ivec3(fl)+uOI[o])&255; f=p-fl; }
}
float grd(float hv,vec3 d){
  int g=int(hv*12.);
  float u=g<8?d.x:d.y, v=g<4?d.y:d.z;
  return ((g&1)==0?u:-u)+((g&2)==0?v:-v);
}
// Gradient noise remapped to roughly [0,1]; mirrored exactly in main.js.
float fin(uint h){ h^=h>>15; h*=0x2C1B3C6Du; h^=h>>12; h*=0x297A2D39u; h^=h>>15; return float(h>>8)*(1./16777216.); }
float vn(int o){
  ivec3 c; vec3 f; cell(o,c,f); vec3 w=f*f*f*(f*(f*6.-15.)+10.);
  uvec3 K=uvec3(0x9E3779B1u,0x85EBCA77u,0xC2B2AE3Du);
  uvec3 p=uvec3(c)*K, q=uvec3((c+1)&255)*K; uint s=uint(o)*0x27D4EB2Fu;
  float a=mix(grd(fin(p.x^p.y^p.z^s),f),grd(fin(q.x^p.y^p.z^s),f-vec3(1.,0.,0.)),w.x);
  float b=mix(grd(fin(p.x^q.y^p.z^s),f-vec3(0.,1.,0.)),grd(fin(q.x^q.y^p.z^s),f-vec3(1.,1.,0.)),w.x);
  float e=mix(grd(fin(p.x^p.y^q.z^s),f-vec3(0.,0.,1.)),grd(fin(q.x^p.y^q.z^s),f-vec3(1.,0.,1.)),w.x);
  float g=mix(grd(fin(p.x^q.y^q.z^s),f-vec3(0.,1.,1.)),grd(fin(q.x^q.y^q.z^s),f-vec3(1.,1.,1.)),w.x);
  return .5+.6*mix(mix(a,b,w.y),mix(e,g,w.y),w.z);
}
float cr(int o){
  ivec3 c; vec3 f; cell(o,c,f);
  if(hsh(c,o+40)>.6) return 0.;
  float r=.1+.22*hsh(c,o+41);
  vec3 ctr=vec3(.5)+(vec3(hsh(c,o+42),hsh(c,o+43),hsh(c,o+44))-.5)*(1.-3.*r);
  float d=length(f-ctr)/r;
  if(d>1.5) return 0.;
  float bowl=d<1.?d*d-1.:0.;
  float rim=exp(-(d-1.)*(d-1.)*25.);
  return (bowl*.55+rim*.18)*r*.5;
}
float emap(float x,float y,float z,int k){
  if(k==0){
    vec2 p=vec2((atan(-z,x)/(2.*PI)+.5)*1024.,(.5-asin(clamp(y,-1.,1.))/PI)*512.)-.5;
    vec2 fl=floor(p),f=p-fl; ivec2 i=ivec2(fl);
    int x0=i.x&1023,x1=(i.x+1)&1023,y0=clamp(i.y,0,511),y1=clamp(i.y+1,0,511);
    gEm=mix(mix(texelFetch(uEarth,ivec2(x0,y0),0).rgb,texelFetch(uEarth,ivec2(x1,y0),0).rgb,f.x),
            mix(texelFetch(uEarth,ivec2(x0,y1),0).rgb,texelFetch(uEarth,ivec2(x1,y1),0).rgb,f.x),f.y);
  }
  return gEm[k];
}
${terrainGlsl}

float n1d(float x){ float i=floor(x),f=x-i; f=f*f*(3.-2.*f); return mix(hsh(ivec3(int(i),7,3),99),hsh(ivec3(int(i)+1,7,3),99),f); }
float h2(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
int omOf(float t,float k){ return clamp(int(floor(29.-log2(max(t*uPix*k,.125)))),0,31); }

// ---- surface colour. Masks gA..gD come from the terrain() call for the same point.
vec3 sunSurf(vec3 n,int om,float ndv){
  float la=asin(clamp(n.y,-1.,1.))*57.29578;
  float g=fb(9,3,om);
  float spot=smoothstep(.3,.42,fb(4,4,om))*smoothstep(4.,10.,abs(la))*(1.-smoothstep(28.,38.,abs(la)));
  float fine=om>15?fb(15,9,om):0.;
  float I=(1.+.4*g+.3*fine)*(1.-.85*spot);
  float ld=.3+.7*pow(max(ndv,0.),.45);
  return vec3(1.7,1.3,.85)*I*ld*mix(vec3(1.,.45,.15),vec3(1.),pow(max(ndv,0.),.5))*3.5;
}
vec3 venusCloud(vec3 n,int om){
  float la=asin(clamp(n.y,-1.,1.)),lo=atan(-n.z,n.x);
  float s=sin(la*5.+1.8*cos(lo+abs(la)*2.)+3.*fb(6,5,om));
  return vec3(.93,.86,.62)*(.84+.16*s);
}
float cloudCov(int om){
  om=min(om,14); prep(7,max(om,8),1,0);
  float w=gN[7]*.6+gN[8]*.4;
  float f=fb(10,5,om)*.5+.5;
  return smoothstep(.52,.8,f*.8+w*.5-.12);
}
vec3 mat(int id,vec3 n,float h,float sl,int om,out float spec){
  spec=0.;
  float x=n.x,y=n.y,z=n.z;
  float la=asin(clamp(y,-1.,1.))*57.29578,lo=atan(-z,x)*57.29578;
  float v1=fb(11,4,om);
  float v2=om>=20?fb(20,6,om):0.;
  vec3 c;
  if(id==10){
    c=mix(vec3(.44,.43,.41),vec3(.15,.15,.165),gA);
    float t=CAP(-43.3,-11.2,1.42);
    c+=.1*exp(-t*.06)*smoothstep(.9,1.4,t)*(.3+.7*smoothstep(.4,.6,om>=12?gN[12]:.5));
    c*=1.+.35*v1+.3*v2;
  } else if(id==1){
    c=mix(vec3(.3,.285,.27),vec3(.38,.34,.3),gA)*(1.+.5*v1+.3*v2);
  } else if(id==2){
    c=mix(vec3(.24,.2,.17),vec3(.4,.36,.3),gA*.7)*(1.+.4*v1+.3*v2);
  } else if(id==3){
    float T=1.-abs(la)/90.;
    if(gA<.5){
      c=mix(vec3(.04,.26,.28),vec3(.008,.035,.11),1.-exp(h/60.)); spec=1.;
      float si=smoothstep(72.,78.,abs(la)+6.*v1+(la<0.?5.:0.));
      c=mix(c,vec3(.8,.85,.9),si); spec*=1.-si;
    } else {
      float tr=1.-smoothstep(12.,26.,abs(la));
      vec3 veg=mix(vec3(.2,.31,.08),vec3(.055,.16,.04),smoothstep(-.1,.25,v1+tr*.5));
      veg=mix(veg,vec3(.42,.4,.2),smoothstep(.15,.45,gC));
      c=mix(veg,vec3(.74,.6,.38),smoothstep(.4,.75,gC));
      c=mix(c,vec3(.33,.31,.22),smoothstep(56.,68.,abs(la)+4.*v1));
      c=mix(c,vec3(.33,.3,.27)*(.82+.18*sin(h*.07)),smoothstep(.45,.9,sl));  // banded rock strata
      c=mix(c,vec3(.8,.66,.42),gC*.5*rdg(20,om));
      float sn=6800.*pow(T,.9)-1000.;
      float snow=smoothstep(sn-250.,sn+250.,h+500.*v1)*(1.-.7*smoothstep(.9,1.6,sl));
      float ice=max(snow,gD);
      c=mix(c,vec3(.86,.89,.93),ice);
      c=mix(c,vec3(.75,.68,.5),(1.-smoothstep(1.,6.,h))*(1.-ice));
      c*=1.+.3*v2;
    }
  } else if(id==4){
    float dk=max(1.-smoothstep(.6,1.,CAP(8.4,69.5,11.)+v1*.4),1.-smoothstep(.6,1.,CAP(46.7,-22.,15.)+v1*.4));
    dk=max(dk,smoothstep(.05,.3,fb(8,4,om))*(1.-smoothstep(20.,50.,abs(la+15.))));
    c=mix(vec3(.5,.24,.11),vec3(.2,.11,.075),dk*.85);
    c=mix(c,vec3(.4,.28,.22)*(.8+.2*sin(h*.05)),smoothstep(.5,1.,sl));
    c=mix(c,vec3(.16,.1,.08),gC*.45*rdg(21,om)*rdg(19,om));
    c=mix(c,vec3(.85,.86,.88),gA);
    c*=1.+.3*v1+.3*v2;
  } else if(id==5){
    float tb=fb(7,6,om);
    float l=la+3.*tb+.7*sin(lo*.2443+la*.3);
    float b=exp(-pow((l-13.)/5.5,2.))+exp(-pow((l+14.)/6.,2.))+.7*exp(-pow((l-28.)/3.,2.))
           +.6*exp(-pow((l+31.)/3.,2.))+.5*exp(-pow((l-41.)/2.5,2.))+.5*exp(-pow((l+42.)/2.5,2.));
    c=mix(vec3(.86,.8,.68),vec3(.55,.34,.2),clamp(b,0.,1.));
    c=mix(c,vec3(.78,.6,.45),.35*clamp(fb(10,4,om)+.3,0.,1.));
    c=mix(c,vec3(.45,.47,.52),smoothstep(50.,68.,abs(la)));
    float gx=(lo+60.)/10.,gy=(la+22.)/6.; float g2=gx*gx+gy*gy+.25*tb;
    c=mix(c,vec3(.9,.86,.78),.5*(1.-smoothstep(1.,1.7,g2)));
    c=mix(c,vec3(.68,.27,.15),1.-smoothstep(.55,1.,g2));
    c*=1.+.12*clamp(h/1300.,-1.,1.);
  } else if(id==6){
    float l=la+1.5*fb(7,5,om);
    float b=.35*sin(l*.19+1.)+.25*sin(l*.47)+.15*sin(l*1.1);
    c=mix(vec3(.84,.74,.52),vec3(.66,.54,.36),smoothstep(-.4,.5,b));
    c=mix(c,vec3(.8,.74,.6),(1.-smoothstep(0.,12.,abs(l)))*.5);
    float a6=mod(lo+180.,60.)-30.;
    float hl=90.-10.4/cos(a6*.0174533);
    c=mix(c,vec3(.42,.47,.5),smoothstep(hl-.4,hl+.4,la)*.75);
    c+=.08*exp(-pow((la-hl)/.6,2.));
    c=mix(c,vec3(.2,.22,.3),smoothstep(88.3,89.2,la));
    c*=1.+.1*clamp(h/1300.,-1.,1.);
  } else if(id==7){
    c=mix(vec3(.56,.82,.87),vec3(.7,.9,.93),smoothstep(30.,80.,abs(la)));
    c*=1.+.03*sin(la*.5)+.03*fb(7,4,om);
  } else if(id==8){
    float tb=fb(7,6,om); float l=la+2.*tb;
    c=mix(vec3(.13,.27,.72),vec3(.09,.18,.55),.5+.5*sin(l*.14+.5));
    float gx=(lo-30.)/15.,gy=(la+20.)/7.; float g2=gx*gx+gy*gy;
    c=mix(c,vec3(.04,.09,.33),1.-smoothstep(.5,1.,g2));
    float w=smoothstep(.02,.25,fb(9,5,om))*(exp(-pow((l+27.5)/2.5,2.))*exp(-gx*gx)+exp(-pow((l+42.)/1.5,2.))+.6*exp(-pow((l-27.)/2.,2.)));
    c=mix(c,vec3(.85,.9,1.),clamp(w,0.,1.)*.8);
    c*=1.+.1*clamp(h/1300.,-1.,1.);
  } else {
    c=mix(vec3(.5,.4,.32),vec3(.62,.52,.42),clamp(.5+v1,0.,1.));
    c=mix(c,vec3(.68,.6,.42),smoothstep(55.,75.,la));
    c=mix(c,vec3(.17,.075,.05),gC*.9);
    c=mix(c,vec3(.8,.76,.7),gB*.8);
    c=mix(c,vec3(.93,.9,.84),gA);
    c=mix(c,vec3(.75,.77,.8),gD*.6);
    c*=1.+.2*v2;
  }
  return max(c,0.);
}

// ---- rings (r in thousands of km)
float bandf(float r,float a,float b){ return smoothstep(a-.12,a+.12,r)*(1.-smoothstep(b-.12,b+.12,r)); }
float ringA(int i,float r,float fp,out vec3 c){
  if(i==6){
    float n1=n1d(r*2.3),n2=n1d(r*19.);
    float a=.03*bandf(r,66.9,74.5)+(.12+.12*n2)*bandf(r,74.5,92.)+(.74+.22*n1)*bandf(r,92.,117.58)
           +(.04+.05*n2)*bandf(r,117.58,122.17)+(.5+.18*n1)*bandf(r,122.17,136.78)*(1.-.9*bandf(r,133.42,133.75))
           +.25*exp(-pow((r-140.22)/.15,2.));
    c=mix(vec3(.5,.43,.36),vec3(.86,.78,.64),clamp(a*1.3,0.,1.))*(.85+.3*n2);
    return clamp(a,0.,1.);
  }
  float w=max(.06,fp); float a=0.;
  a+=exp(-pow((r-41.84)/w,2.))+exp(-pow((r-42.23)/w,2.))+exp(-pow((r-42.57)/w,2.))+exp(-pow((r-44.72)/w,2.))
    +exp(-pow((r-45.66)/w,2.))+exp(-pow((r-47.18)/w,2.))+exp(-pow((r-47.63)/w,2.))+exp(-pow((r-48.3)/w,2.))
    +2.*exp(-pow((r-51.15)/(w*1.5),2.));
  c=vec3(.38,.4,.42);
  return clamp(a*.18*.06/w,0.,.45);
}
vec4 ring(int i,vec3 rd,out float tR){
  tR=-1.;
  vec3 C=uBP[i].xyz,N=uBM[i][1];
  float dn=dot(rd,N); if(abs(dn)<1e-6) return vec4(0.);
  float t=dot(C,N)/dn; if(t<=0.) return vec4(0.);
  vec3 q=rd*t-C; float r=length(q)*1e-6;
  if(r<40.||r>142.) return vec4(0.);
  vec3 c; float a=ringA(i,r,t*uPix*1.5e-6,c);
  if(a<=.001) return vec4(0.);
  vec3 sd=normalize(uBP[0].xyz-C);
  float b=dot(q,sd); float pd=sqrt(max(dot(q,q)-b*b,0.)); float R=uBP[i].w;
  float sh=b<0.?smoothstep(R*.985,R*1.015,pd):1.;
  float lit=dot(N,sd)*dn<0.?1.:.15+1.6*a*(1.-a);
  tR=t;
  return vec4(c*lit*sh*uBC[i].a*1.5,a);
}
float ringShadow(int i,vec3 pw,vec3 sd){
  vec3 N=uBM[i][1]; float dn=dot(sd,N); if(abs(dn)<1e-5) return 1.;
  float t=-dot(pw,N)/dn; if(t<=0.) return 1.;
  vec3 c; float a=ringA(i,length(pw+sd*t)*1e-6,.2,c);
  return 1.-.85*a;
}

// ---- focus body helpers
float altOf(vec3 p){ float num=2.*uR0*dot(p,uUp)+dot(p,p); return uAlt+num/(sqrt(uR0*uR0+num)+uR0); }
// Noise is always sampled on the datum sphere below the point, so a height depends only on direction.
vec3 projP(vec3 q){
  float R=uBP[uF].w; float a=altOf(q); float l=R+a;
  return (q*uFM)*(R/l)-uCamN*(uR0*a/l);
}
bool hsample(vec2 uv,int i,out float h){
  vec4 L=uLv[i]; h=0.;
  if(L.w<.5) return false;
  vec2 d=(uv-L.xy)/(L.z*512.);
  if(max(abs(d.x),abs(d.y))>=.49) return false;
  h=texture(uHT,vec3(d+.5,float(i))).r;
  return true;
}
// Blend adjacent baked levels by pixel footprint so their different octave limits
// cannot form a visible ring or step at the horizon.
bool hmap(vec3 q,float foot,out float h){
  float R=uBP[uF].w; vec3 g=q*uFM; float l=R+altOf(q);
  h=0.;
  if(uCamT.z+dot(g,uC0)<.35*l) return false;
  vec2 uv=(uCamT.xy+vec2(dot(g,uE1),dot(g,uE2)))*(R/l);
  int fine=6;
  if(foot<=uLv[0].z) fine=0;
  else if(foot<uLv[7].z){
    for(int i=0;i<7;i++) if(foot<=uLv[i+1].z){ fine=i; break; }
  }
  int coarse=min(fine+1,7);
  float a=log2(max(uLv[fine].z,1.)),b=log2(max(uLv[coarse].z,1.));
  float t=clamp((log2(max(foot,uLv[fine].z))-a)/max(b-a,1e-4),0.,1.);
  vec2 df=(uv-uLv[fine].xy)/(uLv[fine].z*512.);
  float edge=smoothstep(.35,.49,max(abs(df.x),abs(df.y)));
  float hf=0.; bool vf=hsample(uv,fine,hf);
  if(t>.72||edge>0.){
    float hc=0.; bool vc=hsample(uv,coarse,hc);
    if(vf&&vc){ h=mix(hf,hc,max(smoothstep(.72,1.,t),edge)); return true; }
    if(vf){ h=hf; return true; }
    if(vc){ h=hc; return true; }
  }
  if(vf){ h=hf; return true; }
  float hfallback=0.;
  if(hsample(uv,coarse,hfallback)){ h=hfallback; return true; }
  // A newly focused body is baked from coarse to fine over several frames.
  // Keep using any ready coarser level instead of evaluating full terrain noise
  // at every ray-march step while those levels are being prepared.
  for(int d=1;d<8;d++){
    int farther=coarse+d;
    if(farther<8&&hsample(uv,farther,hfallback)){ h=hfallback; return true; }
    int nearer=fine-d;
    if(nearer>=0&&hsample(uv,nearer,hfallback)){ h=hfallback; return true; }
  }
  return false;
}
float chap(float X,float h,float c){
  float cc=sqrt(X+h);
  if(c>=0.) return cc/(cc*c+1.)*exp(-h);
  float x0=sqrt(max(1.-c*c,0.))*(X+h); float c0=sqrt(x0);
  return 2.*c0*exp(min(X-x0,40.))-cc/(1.-cc*c)*exp(-h);
}
vec3 sunT(float a,float cz){
  float Rg=uBP[uF].w; a=max(a,0.);
  float ch=-sqrt(2.*a/Rg);
  float geo=smoothstep(ch-.006,ch+.008,cz);
  if(uAtmTop<=0.||uF==0) return vec3(geo);
  float cR=chap(Rg/uHR,a/uHR,cz)*uHR, cM=chap(Rg/uHM,a/uHM,cz)*uHM;
  float cD=uDeck.z*max(0.,uDeck.y-max(a,uDeck.x))/max(cz,.08);
  return exp(-min((uBetaR+uBetaA)*cR+uBetaMe*cM+cD,vec3(60.)))*geo;
}
// One loop drives every terrain evaluation (march, bisection, normal, shadow, distant
// body, map) so that terrain() and mat() are each inlined exactly once.
void main(){
  vec2 uv=(gl_FragCoord.xy*2.-uRes)/uRes.y;
  vec3 rd=normalize(uCam*vec3(uv*uTanF,1.));
  float dith=h2(gl_FragCoord.xy+fract(uTime)*91.7);
  vec3 stars=texture(uSky,rd).rgb; stars*=stars*2.4;
  vec3 col=vec3(0.),colFar=vec3(0.);
  int id=uF; float Rg=uBP[id].w; vec3 Cf=uBP[id].xyz;
  vec3 sd=id==0?uUp:normalize(uBP[0].xyz-Cf);
  float mu=dot(rd,uUp), b=uR0*mu;
  float tOpq=1e30; int hit=-1;
  // states: 0 march, 1 bisect, 2 normal, 3 shadow, 4 distant body, 5 done, 6 map, 7 resolve hit
  int stt=7;
  float t=0.,tp=0.,hl=0.,ta=0.,tb=0.,tS=-1.; int ms=0,kb=0,kn=0,ks=0;
  bool shell=false,surf=false,water=false;
  vec3 p=vec3(0.),upL=uUp,t1=vec3(1.,0.,0.),t2=vec3(0.,0.,1.),nr=uUp,alb=vec3(0.),ps=vec3(0.),Ts=vec3(1.);
  float e=1.,h0=0.,h1=0.,h2v=0.,sl=0.,sp=0.,sh=1.,ts=0.,cz=1.,ndl=0.,altP=0.,dpv=max(uClr,1.),h0t=0.,hC=0.,hrC=0.,gx=0.,gy=0.,lodFoot=0.; int omN=0; bool texN=false,mic=false; vec3 nC=uCamN;

  if(uMode>=1){ stt=6; }
  else {
    if(uF!=0){
      vec3 C=uBP[0].xyz; float dC=length(C);
      float ang=atan(length(cross(rd,C)),dot(rd,C));
      float a=max(ang-asin(min(uBP[0].w/dC,1.)),0.);
      col+=vec3(1.,.95,.88)*uGlare*uSunVis*(4./(1.+pow(a/.0035,2.))+.5/(1.+pow(a/.03,2.))+.03/(1.+pow(a/.3,2.)));
    }
    for(int i=0;i<NB;i++){
      if(i==uF) continue;
      vec3 C=uBP[i].xyz; float R=uBP[i].w; float dC=length(C);
      float tc=dot(C,rd); vec3 pp=C-tc*rd; float d2=dot(pp,pp);
      float ar=R/dC;
      if(i>0&&ar<uPix*2.&&tc>0.){
        float ang=sqrt(d2)/dC; float w=uPix*1.4; float br=clamp(ar/uPix,.3,1.5);
        col+=uBC[i].rgb*br*br*exp(-ang*ang/(w*w))*1.2;
      }
      if(tc>0.&&d2<R*R){ float tq=tc-sqrt(R*R-d2); if(tq>0.&&tq<tOpq){ tOpq=tq; hit=i; } }
    }
    if(uShell>0.&&uAlt>uShell){
      float c=(uAlt-uShell)*(2.*Rg+uAlt+uShell); float d=b*b-c;
      if(d>0.&&b<0.){ tS=c/(-b+sqrt(d)); shell=true; }
    } else if(uDisp>0.){
      float t0=0.; bool ok=true;
      if(uAlt>uHmax){ float c=(uAlt-uHmax)*(2.*Rg+uAlt+uHmax); float d=b*b-c; if(d<0.||b>0.) ok=false; else t0=c/(-b+sqrt(d)); }
      if(ok){ t=t0; tp=t0; stt=0; }
    } else {
      float c=uAlt*(2.*Rg+uAlt); float d=b*b-c;
      if(d>0.&&b<0.) tS=c/(-b+sqrt(d));
    }
  }

  int maxIt=uSteps+40;
  for(int it=0;it<maxIt;it++){
    lodFoot=0.;
    if(stt==7){
      if(tS>0.&&tS<tOpq){
        surf=true; p=rd*tS; upL=normalize(uUp*uR0+p); cz=dot(upL,sd);
        if(shell){ stt=5; }
        else {
          omN=min(omOf(tS,2.5),30); e=max(.04,tS*uPix*1.5);
          t1=normalize(cross(upL,abs(upL.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.))); t2=cross(upL,t1);
          kn=0; stt=2;
          // Far enough that a pixel spans metres: take the slope from the baked heights (two cheap
          // texture reads) and keep a single noise evaluation for the surface colour.
          float fp=tS*uPix;
          if(uBake>0&&fp>=3.){
            float E=max(8.,fp*2.),a0,a1,a2;
            if(hmap(p,E*.5,a0)&&hmap(p+t1*E,E*.5,a1)&&hmap(p+t2*E,E*.5,a2)){
              h0t=a0*uDisp; h1=a1*uDisp; h2v=a2*uDisp; e=E; kn=2; texN=true; omN=omOf(tS,3.); lodFoot=tS*uPix*3.;
            }
          } else if(uBake>0){
            // Near: broad slope from the baked heights, fine relief (octaves 25+) from two partial
            // noise evaluations that reuse the centre sample's coarse octaves.
            float a0,a1,a2;
            if(hmap(p,4.,a0)&&hmap(p+t1*8.,4.,a1)&&hmap(p+t2*8.,4.,a2)){
              gx=(a1-a0)*.125*uDisp; gy=(a2-a0)*.125*uDisp; mic=true;
            }
          }
        }
      } else { tS=-1.; stt=hit>=0?4:5; }
    }
    if(stt==5) break;
    int eid=id; int eo=0; vec3 nE=uCamN; float ndvE=1.,dispE=max(uDisp,1e-3),slE=0.;
    vec3 qE=vec3(0.); float ft=0.; bool pre=false;
    gAbs=false;
    if(stt==0){
      qE=rd*t;
      if(ms>=uSteps){
        float c=(uAlt-hl)*(2.*Rg+uAlt+hl); float d=b*b-c;
        if(c<0.) tS=t; else if(d>0.&&b<0.) tS=max(t,c/(-b+sqrt(d))); else tS=-1.;
        stt=7; continue;
      }
      if(altOf(qE)>uHmax*1.02+1.&&dot(rd,uUp*uR0+qE)>0.){ tS=-1.; stt=7; continue; }
      eo=min(min(omOf(t,30.),24),int(floor(30.-log2(max(dpv,.5))))); ft=t*uPix*2.; lodFoot=t*uPix*30.;
    } else if(stt==1){
      float tm=.5*(ta+tb); qE=rd*tm; eo=min(omOf(tm,30.),24); ft=tm*uPix*2.; lodFoot=tm*uPix*30.;
    } else if(stt==2){
      if(mic) qE=kn==0?p:(kn==1?p+t1*e:p+t2*e); else qE=kn==0?p+t1*e:(kn==1?p+t2*e:p);
      eo=omN; lodFoot=tS*uPix*2.5;
    } else if(stt==3){
      qE=ps+sd*ts;
      if(altOf(qE)>uHmax||ks>=12){ stt=5; continue; }
      eo=min(min(omOf(tS+ts,40.),22),int(floor(30.-log2(max(dpv,.5))))); ft=(tS+ts)*uPix*3.; lodFoot=(tS+ts)*uPix*40.;
    } else if(stt==4){
      eid=hit; vec3 nw=normalize(rd*tOpq-uBP[hit].xyz); nE=nw*uBM[hit];
      gAbs=true; gQ=nE*uBP[hit].w; ndvE=max(dot(nw,-rd),0.); dispE=1.;
      eo=clamp(int(floor(28.-log2(max(tOpq*uPix,1.)))),0,18); lodFoot=tOpq*uPix*2.;
    } else if(uMode==2){
      // bake one height level: texel -> direction, noise offset taken relative to the level centre
      vec2 uvb=uBk.xy+(gl_FragCoord.xy-256.)*uBk.z;
      float r2=min(dot(uvb,uvb)/(Rg*Rg),.98), c2=min(dot(uBk.xy,uBk.xy)/(Rg*Rg),.98);
      float z=sqrt(1.-r2);
      nE=normalize(uvb.x/Rg*uE1+uvb.y/Rg*uE2+z*uC0);
      vec2 dd=uvb-uBk.xy;
      gP=dd.x*uE1+dd.y*uE2+uC0*(Rg*(c2-r2)/(z+sqrt(1.-c2)));
      pre=true; eo=uBakeOm; dispE=1.;
    } else {
      vec2 q=gl_FragCoord.xy/uRes; float lo=(q.x-.5)*2.*PI, la=(q.y-.5)*PI;
      nE=vec3(cos(la)*cos(lo),sin(la),-cos(la)*sin(lo));
      eid=uMapId; gAbs=true; gQ=nE*uBP[uMapId].w; eo=15; dispE=1.;
    }
    float hr=0.; bool got=false;
    if(uBake>0&&(stt==0||stt==1||stt==3)) got=hmap(qE,ft,hr);
    // The baked surface is coarser than the collision surface; never let it rise above the eye at the camera.
    if(got&&stt==0&&t<4.) hr=min(hr,uAlt-.5*uClr);
    if(!got){
      if(!gAbs&&!pre){ gP=projP(qE); nE=normalize(uCamN*uR0+gP); }
      bool part=mic&&stt==2&&kn>0;
      if(part) nE=nC;
      gLo=part?25:0;
      gFade=1.;
      if(lodFoot>0.){
        float lod=29.-log2(max(lodFoot,.125));
        if(float(eo)>=floor(lod)) gFade=smoothstep(0.,1.,fract(lod));
      }
      hr=terrain(eid,nE.x,nE.y,nE.z,eo);
      gLo=0;
    }
    if(uMode==2){ oCol=vec4(hr,0.,0.,1.); return; }
    float hv=hr*(gAbs?1.:uDisp);

    bool wm=stt==4||stt==6;
    if(stt==2&&kn==2){
      wm=true; h0=hv; water=hr<uSea;
      if(mic){ h0=hC; h2v=hv; hr=hrC; water=hrC<uSea; }
      float hn=texN?h0t:h0;
      vec2 sg=vec2(h1-hn,h2v-hn)/e+vec2(gx,gy);
      nr=normalize(upL-t1*sg.x-t2*sg.y);
      sl=length(sg);
      if(water){
        float wf=1./(1.+tS*.002); float w1=eo>=28?1.:0., w2=eo>=25?1.:0.;
        nr=normalize(upL+(t1*(gN[27]-.5)+t2*(gN[28]-.5))*.12*wf*w1+(t1*(gN[24]-.5)+t2*(gN[25]-.5))*.05*w2);
        sl=0.;
      }
      slE=sl; ndvE=max(dot(nr,-rd),0.);
    }
    if(wm){
      if(eid==0) alb=sunSurf(nE,eo,ndvE);
      else alb=mat(eid,nE,hr,slE,eo,sp);
    }

    if(stt==0){
      float h=max(hv,uSea); float d=altOf(rd*t)-h; hl=h; ms++; dpv=max(d,0.);
      if(d<.0012*t+.01){ if(d<0.){ ta=tp; tb=t; kb=0; stt=1; } else { tS=t; stt=7; } }
      else { tp=t; t+=max(d*.6,(uStepMin+.3*smoothstep(.45,1.,float(ms)/float(uSteps)))*t+.3); }
    } else if(stt==1){
      float tm=.5*(ta+tb);
      if(altOf(rd*tm)-max(hv,uSea)<0.) tb=tm; else ta=tm;
      kb++; if(kb>=6){ tS=tb; stt=7; }
    } else if(stt==2){
      if(mic&&kn==0){ hC=hv; hrC=hr; nC=nE; }
      if(mic&&kn==1) h1=hv;
      if(!mic&&kn==0) h1=hv;
      if(!mic&&kn==1) h2v=hv;
      if(kn<2){}
      else {
        ndl=dot(nr,sd); if(id>=5&&id<=8) ndl=(ndl+.3)/1.3;
        altP=altOf(p); Ts=sunT(altP,cz);
        if(id!=0&&uShadow>0&&ndl>0.&&tS<3e5&&uDisp>.5&&Ts.g>.001){ ps=p+upL*(.05+tS*.001); ts=max(1.5,tS*.02); ks=0; dpv=ts; stt=3; }
        else stt=5;
      }
      kn++;
    } else if(stt==3){
      float d=altOf(ps+sd*ts)-max(hv,uSea);
      sh=min(sh,10.*d/ts); ks++; dpv=max(d,ts*.25);
      if(sh<.01){ sh=0.; stt=5; } else ts+=max(d*.8,ts*.4);
    } else if(stt==4){
      int i=hit; vec3 nw=normalize(rd*tOpq-uBP[i].xyz); float R=uBP[i].w;
      if(i==0){ colFar=alb; }
      else {
        vec3 sdi=normalize(uBP[0].xyz-uBP[i].xyz);
        vec3 a=alb;
        if(i==2) a=venusCloud(nE,eo);
        if(i==3){ gQ=nE*(R+3500.); a=mix(a,vec3(.92),cloudCov(eo)*.9); }
        float nl=dot(nw,sdi);
        float soft=uRim[i].a>0.?.12:.01;
        vec3 c=a*smoothstep(-soft,soft*2.,nl)*max(nl+soft*.5,0.)*2.*uBC[i].a;
        if(i==3&&sp>.5) c+=vec3(1.,.95,.85)*pow(max(dot(normalize(sdi-rd),nw),0.),90.)*1.5;
        if(i==6||i==7) c*=ringShadow(i,nw*R,sdi);
        colFar=mix(c,uRim[i].rgb*smoothstep(-.2,.4,nl)*uBC[i].a*1.6,uRim[i].a*pow(1.-ndvE,3.));
      }
      stt=5;
    } else {
      vec3 c=eid==0?alb*.25:alb*1.6;
      oCol=vec4(pow(clamp(c,0.,1.),vec3(.4545)),1.);
      return;
    }
  }

  if(surf){
    tOpq=tS; hit=-1;
    float day=smoothstep(-.12,.25,cz);
    if(shell){
      gAbs=false; gP=p*uFM; vec3 nP=normalize(uCamN*uR0+gP);
      int omc=omOf(tS,3.); prep(6,omc,1,0);
      col=venusCloud(nP,omc)*(sunT(uShell,cz)*max((cz+.15)/1.15,0.)*2.2+uAmbS*day*.3)*uLight;
    } else if(id==0){
      col=alb;
    } else {
      sh=clamp(sh,0.,1.);
      if(id==3&&altP<3400.){ gAbs=false; gP=(p+sd*((3500.-altP)/max(cz,.15)))*uFM; sh*=1.-.65*cloudCov(min(16,omOf(tS,3.))); }
      if(id==6||id==7) sh*=ringShadow(id,rd*tS-Cf,sd);
      vec3 ambS=uAmbS;
      if(id==10) ambS=max(ambS,vec3(.025,.023,.02));
      vec3 L=Ts*max(ndl,0.)*sh*2.+ambS*day*(.6+.4*dot(nr,upL));
      col=alb*L*uLight;
      if(sp>0.){
        float fr=pow(1.-max(dot(-rd,nr),0.),5.);
        col=mix(col,uAmbS*day*2.2*uLight,fr*.7*sp);
        col+=Ts*sh*sp*uLight*5.*pow(max(dot(normalize(sd-rd),nr),0.),220.);
      }
    }
  } else if(hit>=0){
    col=colFar;
  }
  bool opaque=surf||hit>=0;

  // Earth cloud layer
  if(id==3){
    float Hc=3500.; float c=(uAlt-Hc)*(2.*Rg+uAlt+Hc); float d=b*b-c; float tc=-1.;
    if(d>0.){ float s=sqrt(d); tc=c<0.?-b+s:(b<0.?c/(-b+s):-1.); }
    if(tc>0.&&tc<tOpq){
      vec3 q=rd*tc; gAbs=false; gP=q*uFM;
      float cv=cloudCov(omOf(tc,3.))*(1.-smoothstep(3e5,9e5,tc)*step(uAlt,Hc));
      vec3 uq=normalize(uUp*uR0+q); float czq=dot(uq,sd);
      vec3 cc=(sunT(Hc,czq)*(uAlt>Hc?max(czq,0.)*2.+.3:1.3+.7*max(czq,0.))+uAmbS*smoothstep(-.12,.25,czq)*1.4)*uLight;
      if(uAlt<Hc) cc*=mix(1.,.5,cv);
      col=mix(col,cc,cv*.93); stars*=1.-cv;
      if(cv>.5) opaque=true;
    }
  }
  // rings
  for(int i=6;i<=7;i++){
    float tR; vec4 rc=ring(i,rd,tR);
    if(tR>0.&&tR<tOpq){ col=mix(col,rc.rgb,rc.a); stars*=1.-rc.a; }
  }

  // atmosphere of the focus body
  vec3 insc=vec3(0.),T=vec3(1.);
  if(uAtmTop>0.){
    float c=(uAlt-uAtmTop)*(2.*Rg+uAlt+uAtmTop); float d=b*b-c;
    if(d>0.){
      float s=sqrt(d); float sa=max(0.,-b-s), sb=min(-b+s,tOpq);
      if(sb>sa){
        float cs=dot(rd,sd);
        float phR=3./(16.*PI)*(1.+cs*cs);
        float g=uG; float phM=(1.-g*g)/(4.*PI*pow(1.+g*g-2.*g*cs,1.5));
        vec3 mieC=uBetaM*mix(vec3(1.),uMieF,smoothstep(.8,1.,cs));
        float oR=0.,oM=0.,oD=0.; float fN=float(uAtmN);
        for(int i=0;i<uAtmN;i++){
          float xx=(float(i)+dith)/fN;
          // sample densely where the air is dense: near the camera inside, near the far end from space
          float uu=sa>0.?1.-(1.-xx)*(1.-xx):xx*xx;
          float tt=sa+(sb-sa)*uu; float dt=(sb-sa)*2.*(sa>0.?1.-xx:xx)/fN;
          vec3 q=rd*tt; float a=max(altOf(q),-3000.);
          float czq=dot(normalize(uUp*uR0+q),sd);
          float dR=exp(-a/uHR), dM=exp(-a/uHM);
          float dD=uDeck.z>0.?uDeck.z*smoothstep(uDeck.x-1500.,uDeck.x+1500.,a)*(1.-smoothstep(uDeck.y-3000.,uDeck.y,a)):0.;
          if(id==9) dM*=1.+.6*sin(a*.0012);
          oR+=dR*dt*.5; oM+=dM*dt*.5; oD+=dD*dt*.5;
          if(id==0){
            insc+=(uBetaR*dR+uBetaM*dM)*dt;
          } else {
            vec3 Tv=exp(-min((uBetaR+uBetaA)*oR+uBetaMe*oM+oD,vec3(60.)));
            vec3 Tq=sunT(a,czq);
            float day=smoothstep(-.14,.25,czq);
            vec3 sc=(uBetaR*dR*phR+mieC*dM*phM)*Tq*16.
                   +(uBetaR*dR+uBetaM*dM)*uAmb*day
                   +dD*uDeckCol*(Tq*1.2+uAmb*day);
            insc+=Tv*sc*dt;
          }
          oR+=dR*dt*.5; oM+=dM*dt*.5; oD+=dD*dt*.5;
        }
        if(id!=0) T=exp(-min((uBetaR+uBetaA)*oR+uBetaMe*oM+oD,vec3(60.)));
        insc*=uLight;
      }
    }
  }
  if(!opaque) col+=stars*(1.-smoothstep(.01,.12,dot(insc,vec3(.33))));
  col=col*T+insc;
  col=1.-exp(-col*uExp);
  col=pow(col,vec3(.4545))+(dith-.5)/255.;
  oCol=vec4(col,1.);
}`;
