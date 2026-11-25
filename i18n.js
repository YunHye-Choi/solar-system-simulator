(() => {
  const phrases = {
    '태양계 여행':'Solar System Journey','출발':'Launch','별을 띄우는 중…':'Loading the stars…','화질':'Quality','낮음':'Low','보통':'Medium','높음':'High',
    '태양':'Sun','수성':'Mercury','금성':'Venus','지구':'Earth','화성':'Mars','목성':'Jupiter','토성':'Saturn','천왕성':'Uranus','해왕성':'Neptune','명왕성':'Pluto','달':'Moon',
    '헬리오포즈(약 120 AU)입니다. 태양계 밖으로는 나갈 수 없습니다.':'Heliopause (~120 AU): you cannot travel beyond the Solar System.',
    '이 브라우저에서는 WebGL2를 사용할 수 없습니다. 최신 Chrome, Edge, Firefox에서 열어 주세요.':'WebGL 2 is unavailable. Open this page in a recent version of Chrome, Edge, or Firefox.',
    '셰이더 컴파일 오류:':'Shader compilation error:', '셰이더 링크 오류:':'Shader linking error:',
    '지구 지도 데이터(earth-data.js)를 읽지 못했습니다.':'Could not load Earth map data (earth-data.js).',
    '궤도에서 내려다보는 중 · 같은 키를 다시 누르면 착륙합니다':'Viewing from orbit · press the same key again to land',
    '도착':'Arrived','가장 가까운 표면':'Nearest surface','표면':'Surface',
    '페르세우스 팔':'Perseus Arm','궁수자리 팔':'Sagittarius Arm','방패–센타우루스 팔':'Scutum–Centaurus Arm','직각자자리 팔':'Norma Arm','은하 중심':'Galactic Center','태양계 (오리온 팔)':'Solar System (Orion Spur)',
    '우리은하 · 태양은 중심에서 약 2만 6천 광년':'Milky Way · the Sun is about 26,000 light-years from the center',
    '내비게이션 · 목적지 선택':'Navigation · choose a destination','같은 키를 다시 누르면 착륙 지점이 바뀝니다':'Press the same key again to change the landing site','W: 목적지로 직진 · X: 해제 · N: 닫기':'W: fly to destination · X: clear · N: close',
    '위치':'Position','고도':'Altitude','지표에서':'from surface','행성 간 공간':'Interplanetary space','가장 가까운 천체':'Nearest body','속도':'Speed','시각':'Time','정지':'Paused','실시간':'Realtime','대기':'Atmosphere','기압':'Pressure','표면 기준':'at surface','조성':'Composition','기온':'Temperature','중력':'Gravity','지구의':'Earth','배':'times','목적지':'Destination','W를 누르면 직진':'press W to fly straight','도보':'walking','비행':'flying','근처':'nearby','착륙 지점':'landing sites','곳':'','광속의':'of light speed','배율':'multiplier','시간':'hours','일':'days',
    '태양계 (로그 축척) · 태양까지':'Solar System (log scale) · distance to Sun',
    '수소 73% · 헬륨 25% 플라스마':'73% hydrogen · 25% helium plasma','약 5,500°C (광구)':'~5,500°C (photosphere)','광구':'Photosphere','채층':'Chromosphere','전이 영역':'Transition region','코로나':'Corona',
    '외기권(Na · O · H · He), 사실상 진공':'Exosphere (Na · O · H · He), near vacuum','외기권(He · Ar · Na), 사실상 진공':'Exosphere (He · Ar · Na), near vacuum','외기권':'Exosphere',
    'CO₂ 96.5% · N₂ 3.5% · 황산(H₂SO₄) 구름':'96.5% CO₂ · 3.5% N₂ · sulfuric acid (H₂SO₄) clouds','하층 대기(구름 아래)':'Lower atmosphere (below clouds)','황산 구름층':'Sulfuric acid clouds','상층 연무':'Upper haze','열권':'Thermosphere',
    '대류권':'Troposphere','성층권':'Stratosphere','중간권':'Mesosphere','열권(카르만 선 100 km)':'Thermosphere (Kármán line at 100 km)',
    '올림푸스 몬스 동쪽 기슭':'Eastern foothills of Olympus Mons','게일 크레이터':'Gale Crater','예제로 크레이터':'Jezero Crater','마리네리스 협곡':'Valles Marineris','크리세 평원':'Chryse Planitia','헬라스 분지':'Hellas Planitia','유토피아 평원':'Utopia Planitia','구세프 크레이터':'Gusev Crater',
    '칼로리스 분지':'Caloris Basin','알프스':'Alps','로키산맥':'Rocky Mountains','안데스':'Andes','히말라야 남쪽 기슭':'Southern Himalayas','사하라':'Sahara','아마존':'Amazon','알래스카':'Alaska','북극성':'Polaris','시리우스':'Sirius','카노푸스':'Canopus','베가(직녀성)':'Vega','베텔게우스':'Betelgeuse','안드로메다은하':'Andromeda Galaxy','대마젤란은하':'Large Magellanic Cloud','소마젤란은하':'Small Magellanic Cloud'
  };
  const dict = Object.entries(phrases).sort((a,b)=>b[0].length-a[0].length);
  window.tr = (value) => {
    if (window.lang !== 'en' || typeof value !== 'string') return value;
    let out = value;
    for (const [ko,en] of dict) out = out.split(ko).join(en);
    return out;
  };
  const nativeFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function(value, ...args) { return nativeFillText.call(this, window.tr(String(value)), ...args); };
  window.lang = localStorage.getItem('solar-lang') || 'en';
  function applyLanguage(lang) {
    window.lang = lang;
    localStorage.setItem('solar-lang', lang);
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-en][data-ko]').forEach(el => el.textContent = el.dataset[lang]);
    document.getElementById('lang').textContent = lang === 'en' ? '한국어' : 'English';
    document.getElementById('lang').setAttribute('aria-label', lang === 'en' ? '한국어로 변경' : 'Switch to English');
    document.title = lang === 'en' ? 'Solar System Journey' : '태양계 여행';
  }
  window.addEventListener('DOMContentLoaded', () => {
    applyLanguage(window.lang);
    document.getElementById('lang').addEventListener('click', () => applyLanguage(window.lang === 'en' ? 'ko' : 'en'));
  });
})();
