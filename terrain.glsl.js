// Terrain height field, written once in a scalar-only GLSL subset.
// index.html compiles it as GLSL for rendering and transpiles it to JS for
// collision, so the ground the player stands on matches the ground drawn.
//
// Octave o has wavelength 2^(29-o) metres (o=9: 1048 km, o=19: 1 km, o=29: 1 m).
// CAP(lat, lonEast, radiusDeg) expands to an angular distance in units of the radius.
window.TERRAIN_SRC = `
float gA,gB,gC,gD,gE0,gE1,gE2;
// Fade the finest visible octave across its pixel-footprint transition to avoid LOD popping.
float gFade=1.;
// Octaves below gLo keep their previous samples (used to re-evaluate only the fine detail nearby).
int gLo=0;
float gN[32];
float gC2[32];

// Noise is sampled once per octave and reused by every term below; the shader
// inlines each call, so sampling inside fb/rg would multiply compile time.
void prep(int o0,int om,int c0,int c1){
  for(int o=max(o0,gLo);o<32;o++){ if(o>om) break; gN[o]=vn(o); }
  for(int o=max(c0,gLo);o<=c1;o++){ if(o>om) break; gC2[o]=cr(o); }
}

float cap(float x,float y,float z,float cx,float cy,float cz,float ir){
  float dx=x-cx; float dy=y-cy; float dz=z-cz;
  return 2.*asin(min(1.,.5*sqrt(dx*dx+dy*dy+dz*dz)))*ir;
}
float fb(int o0,int n,int om){
  float s=0.; float a=.5;
  for(int k=0;k<n;k++){ int o=o0+k; if(o>om) break; s+=a*(gN[o]*2.-1.)*(o==om?gFade:1.); a*=.5; }
  return s;
}
float rg(int o0,int n,int om){
  float s=0.; float a=.5; float w=1.;
  for(int k=0;k<n;k++){ int o=o0+k; if(o>om) break; float v=1.-abs(gN[o]*2.-1.); v=v*v; s+=a*v*w*(o==om?gFade:1.); w=clamp(v*1.5,0.,1.); a*=.5; }
  return s;
}
float crs(int o0,int o1,int om){
  float s=0.;
  for(int o=o0;o<=o1;o++){ if(o>om) break; s+=gC2[o]*OL(o)*(o==om?gFade:1.); }
  return s;
}
// Octave sample that is neutral when the level of detail has not reached it.
float gv(int o,int om){ float v=.5; if(o<om){ v=gN[o]; } else if(o==om){ v=mix(.5,gN[o],gFade); } return v; }
// 1 along the octave's mid line, 0 away from it: thin winding features (valleys, rilles, dune crests).
float rdg(int o,int om){ return 1.-abs(gv(o,om)*2.-1.); }
float bigc(float t,float D){
  float b=0.;
  if(t<1.){ b=-D*(1.-t*t); }
  return b+.25*D*exp(-(t-1.)*(t-1.)*25.)+.3*D*exp(-t*t*45.);
}
float volc(float d,float H){
  float s=1.-smoothstep(0.,1.,d);
  return H*s*sqrt(s)-.1*H*(1.-smoothstep(.08,.16,d));
}

float terrain(int id,float x,float y,float z,int om){
  gA=0.; gB=0.; gC=0.; gD=0.;
  float h=0.;
  int o0=9; int c1=-1;
  if(id==0){ o0=4; }
  if(id==2){ o0=6; }
  if(id==3){ o0=11; }
  if(id==4){ o0=8; }
  if(id>=5){ if(id<=8){ o0=7; } }
  if(id==1){ c1=27; }
  if(id==4){ c1=27; }
  if(id>=9){ c1=27; }
  prep(o0,om,10,c1);
  if(id==10){
    // Moon: maria (dark basalt lowlands) at their observed positions.
    float e=fb(10,4,om)*.3;
    float m=0.;
    m=max(m,1.-smoothstep(.7,1.,CAP(32.8,-15.6,19.)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(28.,17.5,11.5)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(8.5,31.4,14.)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(17.,59.1,9.)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(-7.8,51.3,11.)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(-15.2,35.5,5.5)+e));
    m=max(m,.9*(1.-smoothstep(.6,1.,CAP(18.4,-57.4,28.)+e*1.6)));
    m=max(m,1.-smoothstep(.7,1.,CAP(-21.3,-16.6,11.)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(-24.4,-38.6,6.5)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(56.,-20.,7.)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(56.,15.,7.)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(-19.4,-92.8,5.)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(27.3,147.9,4.5)+e));
    m=max(m,1.-smoothstep(.7,1.,CAP(1.3,87.5,6.)+e));
    m=max(m,.6*(1.-smoothstep(.7,1.,CAP(-38.9,93.,8.)+e)));
    float hi=1400.+2200.*fb(9,6,om);
    float ma=-1900.+120.*fb(13,4,om);
    h=mix(hi,ma,m)+crs(11,27,om)*(1.-.8*m)+4.*fb(22,4,om)+.35*fb(26,5,om)
      -m*130.*pow(rdg(16,om),14.)+m*60.*pow(rdg(14,om),6.);  // sinuous rilles and wrinkle ridges in the maria
    h+=bigc(CAP(-43.3,-11.2,1.42),4500.)+bigc(CAP(9.62,-20.08,1.53),3700.);
    gA=m;
  } else if(id==1){
    // Mercury: cratered crust, Caloris basin.
    float e=fb(9,5,om);
    float c=CAP(30.5,170.,18.2)+e*.15;
    float pl=max(1.-smoothstep(.75,1.,c),smoothstep(.15,.45,e)*.8);
    h=1600.*e+500.*fb(12,6,om)+crs(10,27,om)*(1.-.6*pl)-1800.*(1.-smoothstep(.6,1.,c))
      +1300.*exp(-(c-1.)*(c-1.)*120.)+3.*fb(22,4,om)+.3*fb(26,5,om)
      +500.*smoothstep(.49,.51,gv(13,om))*(1.-pl);  // lobate scarps
    gA=pl;
  } else if(id==2){
    // Venus: volcanic plains with Ishtar, Aphrodite, Beta and Atla highlands.
    float e=fb(9,4,om)*.25;
    float i1=1.-smoothstep(.55,1.,CAP(70.,27.5,17.)+e);
    float mx=1.-smoothstep(.3,1.,CAP(65.2,3.3,4.5)+e);
    float a1=1.-smoothstep(.5,1.,CAP(-8.,85.,18.)+e);
    float a2=1.-smoothstep(.5,1.,CAP(-12.,125.,15.)+e);
    float b1=1.-smoothstep(.4,1.,CAP(25.3,-77.2,9.)+e);
    float a3=1.-smoothstep(.4,1.,CAP(9.,-160.,7.)+e);
    float hl=max(max(i1,a1),max(a2,max(b1,a3)));
    float r=rg(14,10,om);
    h=500.*fb(9,6,om)+250.*fb(14,6,om)+hl*(2600.+1800.*r)+mx*(4500.+3500.*r)
      +2.*fb(22,5,om)+.25*fb(26,5,om)
      +max(hl,mx)*(140.*rdg(19,om)+90.*rdg(20,om))    // tessera: crossed ridges on the highlands
      -(1.-hl)*120.*pow(rdg(15,om),12.);              // lava channels on the plains
    gA=max(hl,mx); gB=r;
  } else if(id==3){
    // Earth: coastlines from the land map, ranges from the mountain map.
    gE0=emap(x,y,z,0); gE1=emap(x,y,z,1); gE2=emap(x,y,z,2);
    float cn=fb(12,7,om);
    float L=gE0+cn*.4*(1.-abs(2.*gE0-1.));
    float e=L-.5;
    float ic=max(1.-smoothstep(-.93,-.88,y),1.-smoothstep(.6,1.,CAP(73.,-41.,11.)));
    if(e>0.){
      float s=smoothstep(0.,.06,e);
      float e2=smoothstep(0.,.5,e);
      float hills=smoothstep(.4,.7,om>=12?gN[12]:.5)*(1.-gE2*.6);
      float r=rg(14,12,om);
      float hh=hills*(60.+420.*rg(16,9,om));
      float ter=floor(hh/90.)*90.+90.*smoothstep(.35,.65,fract(hh/90.));
      hh=mix(hh,ter,smoothstep(.2,.5,gE2));                       // arid hills step into mesas
      float pl=180.*e2+90.*(fb(13,5,om)+.5)*e2+hh
        -e2*(1.-gE1)*90.*pow(rdg(15,om),8.)                        // river valleys
        +gE2*(22.*rdg(20,om)*rdg(18,om)+6.*rdg(23,om));            // dune fields
      float mt=gE1*gE1*(900.+7000.*r)+gE1*(600.+350.*fb(17,6,om));
      h=s*(1.5+pl+mt+ic*2300.*e2)+25.*e+s*(1.6*fb(22,5,om)+.25*fb(26,4,om));
      gB=gE1*r;
    } else {
      h=-min(5500.,16000.*(-e))*(1.+.25*fb(13,4,om));
    }
    gA=smoothstep(-.002,.002,e); gC=gE2; gD=ic;
  } else if(id==4){
    // Mars: dichotomy, Tharsis volcanoes, Valles Marineris, Hellas, Argyre, polar caps.
    float e=fb(9,5,om);
    float dich=smoothstep(-.2,.25,y*.95+x*.2-z*.15+e*.5);
    float th=1.-smoothstep(0.,1.,CAP(-2.,-105.,40.));
    float v1=CAP(18.65,-133.8,5.3);
    float v2=CAP(11.9,-104.1,3.9);
    float v3=CAP(1.5,-113.,3.3);
    float v4=CAP(-8.4,-120.9,4.);
    float v5=CAP(25.,147.2,3.6);
    float vo=volc(v1,19000.)+volc(v2,13000.)+volc(v3,9500.)+volc(v4,12500.)+volc(v5,11000.);
    float vm=1.-smoothstep(.8,1.3,min(min(v1,v2),min(min(v3,v4),v5)));
    float la=asin(clamp(y,-1.,1.))*57.29578;
    float lo=atan(-z,x)*57.29578;
    float u=(lo+95.)/55.;
    float cl=-4.-10.*u+1.2*sin(u*9.)+e*1.5;
    float cd=abs(la-cl)/(1.3+.9*sin(clamp(u,0.,1.)*3.14159));
    float vall=(1.-smoothstep(.35,1.,cd))*smoothstep(-.05,.05,u)*(1.-smoothstep(.95,1.05,u));
    float he=CAP(-42.4,70.5,19.5)+e*.1;
    float ar=CAP(-49.7,-44.,10.)+e*.1;
    float pc=max(smoothstep(.984,.992,y+e*.006),1.-smoothstep(-.9965,-.993,y+e*.004));
    h=mix(1800.,-3600.,dich)+1300.*e+500.*fb(12,6,om)+5200.*th+vo
      -6500.*vall*(1.-.25*rg(15,6,om))
      -7000.*(1.-smoothstep(.3,1.,he))+1200.*exp(-(he-1.)*(he-1.)*60.)
      -3500.*(1.-smoothstep(.3,1.,ar))
      +crs(11,27,om)*(1.-.65*dich)*(1.-vm)*(1.-pc)
      +pc*1200.+2.2*fb(22,5,om)+.3*fb(26,5,om)
      +dich*14.*rdg(21,om)*rdg(19,om)                              // dune fields on the northern plains
      -(1.-dich)*(1.-vm)*350.*pow(rdg(14,om),10.)                  // dry outflow channels in the highlands
      +dich*(1.-dich)*2400.*smoothstep(.55,.6,gv(16,om));          // mesas along the dichotomy boundary
    gA=pc; gB=vm; gC=dich; gD=vall;
  } else if(id==9){
    // Pluto: Sputnik Planitia (the bright lobe of the heart), Cthulhu Macula, ice mountains.
    float e=fb(9,5,om);
    float d1=CAP(22.,178.,21.)+e*.12;
    float m1=1.-smoothstep(.85,1.,d1);
    float m2=(1.-smoothstep(.6,1.,CAP(6.,-154.,17.)+e*.3))*(1.-m1);
    float la=asin(clamp(y,-1.,1.))*57.29578;
    float lo=atan(-z,x)*57.29578;
    float m3=(1.-smoothstep(9.,14.,abs(la+10.+e*8.)))*smoothstep(15.,30.,lo)*(1.-smoothstep(150.,163.,lo))*(1.-m1);
    float mtn=exp(-(d1-1.03)*(d1-1.03)*90.)*smoothstep(120.,150.,lo)*(1.-smoothstep(168.,178.,lo));
    float rough=900.*e+1500.*fb(11,7,om)+crs(11,26,om);
    float plain=-2400.+18.*(1.-abs((om>=15?gN[15]:.5)*2.-1.));
    h=mix(rough,plain,m1)+mtn*(1200.+3800.*rg(16,9,om))+m2*400.*rg(15,6,om)
      +1.5*fb(22,5,om)*(1.-.8*m1)+.25*fb(26,5,om)
      +m2*260.*pow(rdg(19,om),2.)                                  // bladed terrain
      -m1*25.*smoothstep(.72,.8,gv(20,om));                        // sublimation pits on the ice plain
    gA=m1; gB=m2; gC=m3; gD=mtn;
  } else if(id==0){
    // Sun: the photosphere is treated as a walkable level; relief is illustrative.
    h=30000.*fb(9,4,om)+250.*fb(16,5,om)+4.*fb(22,6,om);
  } else {
    // Gas and ice giants: the 1 bar level, drawn as cloud tops.
    float k=1.;
    if(id==7){ k=.25; }
    h=k*(1300.*fb(14,5,om)+110.*fb(19,4,om)+5.*fb(23,5,om)
         +1500.*smoothstep(.6,.85,gv(13,om))*(.5+.5*gv(16,om)));  // convective towers
  }
  return h;
}
`;
