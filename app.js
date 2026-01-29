/* Prototipo con mapa de referencia estático y termómetro controlado desde un iframe de Flourish (story). */

// === CONFIGURACIÓN DE MAPBOX - MAPA DE REFERENCIA ===
let mapReference;
let mapReferenceReady = false;
let pendingStepForMap = null;

function initReferenceMap() {
  try {
    if (!mapboxgl || !window.MAPBOX_TOKEN || window.MAPBOX_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN') throw new Error('Sin token Mapbox válido o biblioteca no cargada');

    mapboxgl.accessToken = window.MAPBOX_TOKEN;

    mapReference = new mapboxgl.Map({
      container: 'map-reference-container',
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-6.08194, 41.55218], // Centro ajustado de Zamora provincia
      zoom: 6.75, // Zoom (~35 km visibles)
      pitch: 0,
      bearing: 0,
      interactive: true, // Mapa interactivo: arrastra para mover, rueda para zoom
      dragPan: true,     // Permitir arrastrar para mover
      dragRotate: true,  // Permitir arrastrar para rotar (Ctrl/Cmd + arrastrar)
      scrollZoom: true,  // Permitir zoom con rueda del ratón
      boxZoom: true,     // Permitir zoom con caja (Shift + arrastrar)
      doubleClickZoom: true // Permitir zoom doble clic
    });

    // Añadir controles de navegación
    mapReference.addControl(new mapboxgl.NavigationControl(), 'top-right');
    
    // Añadir control de escala
    mapReference.addControl(new mapboxgl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');
    
    // Añadir control de pantalla completa
    mapReference.addControl(new mapboxgl.FullscreenControl(), 'top-right');
    
    // Añadir control de geolocalización
    mapReference.addControl(new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true
    }), 'top-right');

    mapReference.on('load', () => {
      mapReferenceReady = true;
      if (pendingStepForMap) {
        flyToComarcaFromStep(pendingStepForMap);
        pendingStepForMap = null;
      }
      console.log('Mapa de referencia cargado, añadiendo datos...');
      
      // Configurar fondo blanco
      try {
        mapReference.setPaintProperty('background', 'background-color', '#ffffff');
      } catch (e) {
        console.log('Background layer not available yet');
      }
      
      // Cargar datos de comarcas primero
      fetch('geojson/comarcas_reference.geojson')
        .then(response => response.json())
        .then(data => {
          // Capa de tinte amarillo para TODO el mapa
          mapReference.addSource('full-yellow', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [[
                    [-180, -85],
                    [-180, 85],
                    [180, 85],
                    [180, -85],
                    [-180, -85]
                  ]]
                }
              }]
            }
          });
          
          // Añadir fuente GeoJSON de Zamora
          mapReference.addSource('zamora-ref', {
            type: 'geojson',
            data: data
          });

          // Capa de relleno con colores por incremento/pérdida porcentual acumulada
          // Verdes para ganancia, rojos para pérdida
          mapReference.addLayer({
            id: 'municipios-fill-ref',
            type: 'fill',
            source: 'zamora-ref',
            filter: ['!=', ['get', 'poblacion'], null],
            paint: {
              'fill-color': [
                'interpolate', ['linear'], ['coalesce', ['get', 'perdida_pct_1960_2020'], 0],
                -50, '#d2691e',     // Marrón oscuro para ganancia muy alta
                0, '#2a9d8f',       // Verde para estable/sin cambio
                25, '#d4a574',      // Terracota suave para pérdida moderada
                50, '#e76f51',      // Terracota para pérdida crítica
                100, '#c1440e'      // Rojo oscuro para pérdida muy alta
              ],
              'fill-opacity': 0.75
            }
          });

          // Capa de contorno con líneas bien definidas
          mapReference.addLayer({
            id: 'municipios-outline-ref',
            type: 'line',
            source: 'zamora-ref',
            filter: ['!=', ['get', 'poblacion'], null],
            paint: {
              'line-color': '#333333',
              'line-width': 1.2,
              'line-opacity': 0.9
            }
          });

          // Añadir el tinte amarillo al final para cubrir todo el mapa con 50% de opacidad
          mapReference.addLayer({
            id: 'full-yellow-fill',
            type: 'fill',
            source: 'full-yellow',
            paint: {
              'fill-color': '#FFD200',
              'fill-opacity': 0.1
            }
          });

          // Cargar límites provinciales para resaltar el contorno
          fetch('zamora_provincia.geojson')
            .then(response => response.json())
            .then(provinciaData => {
              mapReference.addSource('provincia-limits', {
                type: 'geojson',
                data: provinciaData
              });

              // Capa de borde provincial resaltado (encima de los municipios)
              mapReference.addLayer({
                id: 'provincia-outline',
                type: 'line',
                source: 'provincia-limits',
                paint: {
                  'line-color': '#2c3e50',
                  'line-width': 3.5,
                  'line-opacity': 0.95
                }
              }, 'municipios-outline-ref'); // Insertar debajo de otros elementos si es necesario

              // Mantener el tinte amarillo por encima de todo
              try {
                mapReference.moveLayer('full-yellow-fill');
              } catch (e) {
                console.warn('No se pudo reordenar full-yellow-fill:', e);
              }
            })
            .catch(err => {
              console.warn('Error al cargar límites provinciales:', err);
            });

          // Crear popup reutilizable
          const popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            maxWidth: '280px'
          });

          // Evento para mostrar popup al pasar el mouse
          mapReference.on('mousemove', 'municipios-fill-ref', (e) => {
            if (e.features.length > 0) {
              const feature = e.features[0];
              const props = feature.properties;
              
              // Solo mostrar popup si hay datos
              if (props.poblacion === null) {
                mapReference.getCanvas().style.cursor = '';
                popup.remove();
                return;
              }
              
              mapReference.getCanvas().style.cursor = 'pointer';
              
              const poblacionActual = props.poblacion ? props.poblacion.toLocaleString('es-ES') : 'N/A';
              const cambio_pct = props.perdida_pct_1960_2020 ? props.perdida_pct_1960_2020.toFixed(1) : 0;
              const colorCambio = cambio_pct > 0 ? '#2a9d8f' : '#e76f51'; // Verde si ganancia, rojo si pérdida
              const signo = cambio_pct > 0 ? '+' : ''; // Mostrar + para ganancia, - para pérdida
              
              const html = `
                <div style="font-family: system-ui; font-size: 0.9rem; padding: 0;">
                  <strong style="font-size: 1.1rem; color: #1c2541; display: block; margin-bottom: 0.6rem;">
                    ${props.nombre}
                  </strong>
                  <div style="border-top: 1px solid #ddd; padding-top: 0.6rem;">
                    <div style="margin-bottom: 0.4rem;">
                      <span style="color: #666; font-size: 0.85rem;">Población actual:</span><br/>
                      <strong style="color: #2a9d8f;">${poblacionActual}</strong> hab.
                    </div>
                    <div>
                      <span style="color: #666; font-size: 0.85rem;">Cambio desde 1960:</span><br/>
                      <strong style="color: ${colorCambio};">${signo}${cambio_pct}%</strong>
                    </div>
                  </div>
                </div>
              `;
              
              popup
                .setLngLat(e.lngLat)
                .setHTML(html)
                .addTo(mapReference);
            }
          });

          // Evento para ocultar popup al salir del municipio
          mapReference.on('mouseleave', 'municipios-fill-ref', () => {
            mapReference.getCanvas().style.cursor = '';
            popup.remove();
          });

          console.log('Mapa de referencia inicializado correctamente con popups');
        })
        .catch(err => {
          console.warn('Error al cargar datos de referencia:', err);
        });
    });

  } catch (err) {
    console.warn('[MAP REFERENCE] Error:', err.message);
  }
}

// === CONFIGURACIÓN DE MAPBOX - MAPA DE EXPLORACIÓN (ANTIGUO) ===
let map, mapReady = false;

function initMap() {
  try {
    if (!mapboxgl || !window.MAPBOX_TOKEN || window.MAPBOX_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN') throw new Error('Sin token Mapbox válido o biblioteca no cargada');

    mapboxgl.accessToken = window.MAPBOX_TOKEN;

    map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-5.75, 41.5], // Centro de Zamora
      zoom: 10
    });

    map.on('load', () => {
      console.log('Mapa cargado, añadiendo datos...');
      // Añadir fuente GeoJSON inicial
      map.addSource('zamora', {
        type: 'geojson',
        data: 'zamora_municipios.geojson'
      });

      // Capa de relleno
      map.addLayer({
        id: 'municipios-fill',
        type: 'fill',
        source: 'zamora',
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'densidad'], 0],
            0, '#ef233c',
            100, '#ffb703',
            1000, '#2a9d8f'
          ],
          'fill-opacity': 0.7
        }
      });

      // Capa de contorno
      map.addLayer({
        id: 'municipios-outline',
        type: 'line',
        source: 'zamora',
        paint: {
          'line-color': '#333',
          'line-width': 1
        }
      });

      // Popup interactivo
      const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });

      map.on('mousemove', 'municipios-fill', (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        popup.setLngLat(e.lngLat)
          .setHTML(`
            <div style="color: #000; background: #fff; padding: 5px; border: 1px solid #000; font-weight: bold;">
              <strong>${f.properties.nombre}</strong><br/>
              Población: ${f.properties.poblacion}<br/>
              %65 años: ${f.properties.p65_pct ? f.properties.p65_pct.toFixed(1) : 'N/A'}%<br/>
              Densidad: ${f.properties.densidad ? f.properties.densidad.toFixed(1) : 'N/A'} hab/km²
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseleave', 'municipios-fill', () => popup.remove());

      console.log('Capas añadidas. Verificando fuente...');
      map.on('sourcedata', (e) => {
        if (e.sourceId === 'zamora' && e.isSourceLoaded) {
          console.log('Fuente GeoJSON cargada:', map.getSource('zamora'));
        }
      });

      mapReady = true;
    });

  } catch (err) {
    console.warn('[MAP] Fallback activado:', err.message);
    document.getElementById('fallback').hidden = false;
  }
}

// === Flourish: control del iframe (story) ===
const flourIfr = document.getElementById('flourishThermo');
const yearToSlide = { 1960:1, 1970:2, 1980:3, 1990:4, 2000:5, 2010:6, 2020:7 };
const scenarioToSlide = { base:8, moderado:9, agresivo:10 };

function setFlourishSlide(n) {
  if (!flourIfr) return;
  const base = flourIfr.src.split('#')[0];
  flourIfr.src = `${base}#slide-${n}`;
}

// === Estado / controles ===
let currentScenario = 'base';
let currentYear = 1960;

const yearInput = document.getElementById('year');
const yearLabel = document.getElementById('yearLabel');

function getYear() { return currentYear; }

function setYear(y) {
  currentYear = y;
  if (yearLabel) yearLabel.textContent = y;
  if (yearInput && y >= +yearInput.min && y <= +yearInput.max) {
    yearInput.value = y;
  }
}

function updateMapForYear(year) {
  if (!mapReady) return;
  // Asumiendo archivos geojson/{year}.geojson
  const dataUrl = `geojson/${year}.geojson`;
  fetch(dataUrl)
    .then(response => response.json())
    .then(data => {
      map.getSource('zamora').setData(data);
    })
    .catch(err => {
      console.warn(`No se pudo cargar datos para ${year}:`, err);
      // Mantener datos actuales
    });
}

function updateMapForScenario(scenario) {
  if (!mapReady) return;
  // Asumiendo archivos geojson/{scenario}.geojson
  const dataUrl = `geojson/${scenario}.geojson`;
  fetch(dataUrl)
    .then(response => response.json())
    .then(data => {
      map.getSource('zamora').setData(data);
    })
    .catch(err => {
      console.warn(`No se pudo cargar datos para escenario ${scenario}:`, err);
      // Mantener datos actuales
    });
}


yearInput?.addEventListener('input', () => {
  const y = +yearInput.value;
  setYear(y);
  updateMapForYear(y);
  onYearChanged(y);
});

document.querySelectorAll('[data-scenario]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    currentScenario = e.target.dataset.scenario;
    setYear(2040);
    updateMapForScenario(currentScenario);
    onScenarioChanged(currentScenario);
    document.querySelectorAll('[data-scenario]').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
  });
});

function onYearChanged(y) {
  if (y !== 2040) {
    const slide = yearToSlide[y] ?? yearToSlide[2020];
    setFlourishSlide(slide);
  }
}

function onScenarioChanged(s) {
  const slide = scenarioToSlide[s] ?? scenarioToSlide.base;
  setFlourishSlide(slide);
}

// === Encuesta simulada ===
const pollResults = document.getElementById('pollResults');
const pollVotes = { base: 32, moderado: 46, agresivo: 22 };

document.querySelectorAll('[data-vote]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const k = e.target.dataset.vote;
    pollVotes[k]++;
    const total = Object.values(pollVotes).reduce((a, b) => a + b, 0);
    const pct = k => Math.round((pollVotes[k] / total) * 100);
    pollResults.innerHTML = `Resultados (simulado): Agresivas ${pct('agresivo')}% · Moderadas ${pct('moderado')}% · Sin intervención ${pct('base')}%`;
  });
});

function pulseButtons() {
  gsap.fromTo('[data-scenario]', { scale: 1 }, { scale: 1.05, repeat: 1, yoyo: true, duration: .25, stagger: .08 });
}

// === Scrollama ===
let scroller;

function flyToComarcaFromStep(stepEl) {
  if (!stepEl) return;
  if (!mapReference || !mapReferenceReady) {
    pendingStepForMap = stepEl;
    return;
  }
  if (!mapReference.isStyleLoaded()) {
    pendingStepForMap = stepEl;
    mapReference.once('idle', () => {
      if (pendingStepForMap) {
        const nextStep = pendingStepForMap;
        pendingStepForMap = null;
        flyToComarcaFromStep(nextStep);
      }
    });
    return;
  }
  const centerAttr = stepEl.getAttribute('data-center');
  const zoomAttr = stepEl.getAttribute('data-zoom');
  if (!centerAttr || !zoomAttr) return;

  const [lng, lat] = centerAttr.split(',').map(v => parseFloat(v.trim()));
  const zoom = parseFloat(zoomAttr);
  if (Number.isNaN(lng) || Number.isNaN(lat) || Number.isNaN(zoom)) return;

  mapReference.flyTo({
    center: [lng, lat],
    zoom,
    speed: 0.8,
    curve: 1.2,
    easing: t => t,
    essential: true
  });
}

function initScroll() {
  scroller = scrollama();
  scroller.setup({ step: '.step', offset: 0.6, debug: false })
    .onStepEnter(res => {
      flyToComarcaFromStep(res.element);
      const id = res.element.dataset.step;
      if (id === 'intro') {
        gsap.fromTo('#map', { opacity: 0, scale: .98 }, { opacity: 1, scale: 1, duration: .6, ease: 'power2.out' });
        onYearChanged(getYear());
      }
      if (id === 'timeline') {
        autoplayTimeline();
        onYearChanged(getYear());
      }
      if (id === 'scenarios') {
        setYear(2040);
        updateMapForScenario('base');
        onScenarioChanged('base');
        pulseButtons();
      }
    })
    .onStepExit(res => {
      const id = res.element.dataset.step;
      if (id === 'timeline') {
        playedTimeline = false;
      }
    });
  window.addEventListener('resize', scroller.resize);

  const firstStep = document.querySelector('.step');
  if (firstStep) {
    flyToComarcaFromStep(firstStep);
  }
}

let playedTimeline = false;
function autoplayTimeline() {
  if (playedTimeline) return;
  playedTimeline = true;
  if (mapReady) {
    [1960, 1980, 2000, 2020].forEach((y, i) => {
      setTimeout(() => {
        setYear(y);
        updateMapForYear(y);
        onYearChanged(y);
      }, i * 800);
    });
    return;
  }

  if (mapReferenceReady && mapReference) {
    const timelineKeyframes = [
      { center: [-6.36, 41.64], zoom: 7.4 },
      { center: [-6.73, 42.04], zoom: 7.2 },
      { center: [-5.67, 42.0], zoom: 7.2 },
      { center: [-6.20, 41.29], zoom: 7.3 }
    ];
    timelineKeyframes.forEach((kf, i) => {
      setTimeout(() => {
        mapReference.flyTo({
          center: kf.center,
          zoom: kf.zoom,
          speed: 0.8,
          curve: 1.2,
          easing: t => t,
          essential: true
        });
      }, i * 900);
    });
  }
}

// === Inicio ===
window.addEventListener('DOMContentLoaded', () => {
  initReferenceMap();
  initMap();
  initScroll();
  setYear(1960);
  updateMapForYear(1960);
  onYearChanged(1960);

  const scrolly = document.querySelector('.scrolly');
  const figure = document.querySelector('.figure');
  const firstStep = document.querySelector('.article .step');
  const article = document.querySelector('.article');

  function updateMobileLayout() {
    if (!scrolly || !figure || !article) return;
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile && firstStep && firstStep.parentElement) {
      firstStep.insertAdjacentElement('beforebegin', figure);
    } else {
      scrolly.insertBefore(figure, article);
    }
  }

  updateMobileLayout();
  window.addEventListener('resize', updateMobileLayout);
});