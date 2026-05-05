// ================================================================
//  VARIABLES GLOBALES
// ================================================================

// --- Reproducción ---
let speed   = 1;       // Velocidad de reproducción de la animación (multiplicador)
let looping = true;    // Si la animación actual hace loop

// --- Escala y zoom ---
let baseScale = 1;     // Escala calculada automáticamente según el tamaño del esqueleto
let userZoom  = 1;     // Zoom extra aplicado por el usuario

// --- Objetos internos de Spine ---
let spCtx;             // Contexto WebGL de Spine (ManagedWebGLRenderingContext)
let spRenderer;        // SceneRenderer de Spine (dibuja el esqueleto)
let spSkeleton;        // Instancia del esqueleto cargado
let spAnimState;       // Estado de animación (controla qué anim corre)

// --- Control de tiempo ---
let lastTime = Date.now() / 1000;   // Timestamp del último frame (en segundos)

// --- Animaciones disponibles ---
let animList  = [];    // Lista de nombres de animaciones del esqueleto actual
let animIndex = 0;     // Índice de la animación actualmente activa
let curAnim   = null;  // Nombre de la animación actualmente activa

// --- Posición de la cámara ---
let offsetX = 0;       // Desplazamiento horizontal del personaje
let offsetY = 0;       // Desplazamiento vertical del personaje

let camBaseX = 0;      // Centro X calculado del esqueleto (base de la cámara)
let camBaseY = 0;      // Centro Y calculado del esqueleto

// --- Audio ---
let music  = null;     // Objeto Audio para la música de fondo
let volume = 0.5;      // Volumen inicial (0.0 - 1.0)

// --- Personajes ---
let characters       = {};          // Objeto cargado desde characters.json
let currentCharacter = "char1";     // Clave del personaje actualmente en pantalla
let currentModelKey  = null;        // Clave del modelo actualmente activo
let useAltAnim       = true;        // Si true, usa animIndex 0; si false, usa animIndex 1

// --- Modo aleatorio ---
// Eliminado: randomOnStart, randomLoop, randomInterval, randomTimer

// --- Fondo ---
let currentBgKey = "bg1";   // Último fondo predefinido seleccionado
let currentBgFit = "cover"; // Ajuste de tamaño del fondo actual
let customBgUrl  = null;    // Object URL de la imagen personalizada (o null si no hay)

// --- Spine / caché ---
let spTexture    = null;   // Textura WebGL activa, guardada para poder destruirla al cambiar de modelo
let loopRunning  = false;  // Evita que se arranquen múltiples loops en paralelo

const MODEL_CACHE_LIMIT = 10;        // Máximo de modelos en caché
const modelCache        = new Map(); // Caché: key → { skel, atlas, img }
const modelCacheOrder   = [];        // Orden de inserción para descartar el más antiguo

// --- Drag scroll ---
let dragScrollInitialized = false; // Evita acumular listeners de document

// --- Mapa de fondos predefinidos ---
const BG_MAP = {
  bg1: "assets/bg/bg1.png",
  bg2: "assets/bg/bg2.png",
  bg3: "assets/bg/bg3.png",
  bg4: "assets/bg/bg4.png",
  bg5: "assets/bg/bg5.png",
  bg6: "assets/bg/bg6.png",
  bg7: "assets/bg/bg7.png",
};

const DEFAULT_BG_NAMES = {
  bg1: "Amanecer",
  bg2: "La aventura comienza",
  bg3: "Valle del olvido",
  bg4: "Fragmento onírico",
  bg5: "Plaza de la aldea",
  bg6: "Parque temático",
  bg7: "Monte luna",
};

function populateBgSelect() {
  const bgSel = document.getElementById("cfg-background");
  if (!bgSel) return;

  bgSel.innerHTML = "";
  Object.keys(BG_MAP).forEach((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = DEFAULT_BG_NAMES[key] || key;
    bgSel.appendChild(option);
  });
  bgSel.value = currentBgKey;
}


// ================================================================
//  RESIZE
//  Ajusta el canvas al tamaño real de la ventana respetando DPR.
// ================================================================
function resize() {
  const canvas = document.getElementById("c");
  const dpr    = window.devicePixelRatio || 1;
  const w      = window.innerWidth;
  const h      = window.innerHeight;

  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width  = w * dpr;
  canvas.height = h * dpr;

  if (spRenderer) {
    spRenderer.camera.setViewport(w, h);
  }

  if (spSkeleton) {
    let offset = new spine.Vector2();
    let size   = new spine.Vector2();
    spSkeleton.getBounds(offset, size, []);

    baseScale = Math.min(
      canvas.clientWidth  / size.x,
      canvas.clientHeight / size.y
    );
  }
}


// ================================================================
//  INIT SPINE
//  Inicializa el motor Spine con los archivos del modelo.
//  El contexto WebGL y el renderer se crean solo la primera vez.
// ================================================================
function initSpine(skelBuf, atlasText, img) {
  const canvas = document.getElementById("c");

  // Crear el contexto WebGL solo la primera vez
  if (!spCtx) {
    spCtx = new spine.webgl.ManagedWebGLRenderingContext(canvas, { antialias: true });
  }

  // Liberar la textura anterior de GPU y crear la nueva
  if (spTexture) {
    spTexture.dispose();
    spTexture = null;
  }

  spTexture = new spine.webgl.GLTexture(spCtx, img);
  spTexture.setFilters(spine.TextureFilter.Linear, spine.TextureFilter.Linear);

  const atlas  = new spine.TextureAtlas(atlasText, () => spTexture);
  const loader = new spine.AtlasAttachmentLoader(atlas);
  const reader = new spine.SkeletonBinary(loader);
  const sd     = reader.readSkeletonData(new Uint8Array(skelBuf));

  spSkeleton = new spine.Skeleton(sd);
  spSkeleton.setToSetupPose();
  spSkeleton.updateWorldTransform();

  spAnimState = new spine.AnimationState(new spine.AnimationStateData(sd));
  animList    = sd.animations.map(a => a.name);

  // Restaurar la última animación guardada, o elegir por defecto
  const savedAnim = localStorage.getItem("lastAnim_" + currentCharacter + "_" + currentModelKey);

  if (savedAnim && animList.includes(savedAnim)) {
    curAnim   = savedAnim;
    animIndex = animList.indexOf(savedAnim);
  } else {
    let index = useAltAnim ? 0 : 1;
    index     = Math.min(index, animList.length - 1);
    curAnim   = animList[index];
    animIndex = index;
  }

  spAnimState.setAnimation(0, curAnim, looping);

  buildAnimList();

  // Crear el renderer solo la primera vez
  if (!spRenderer) {
    spRenderer = new spine.webgl.SceneRenderer(canvas, spCtx);
  }

  // Calcular escala automática
  let offset = new spine.Vector2();
  let size   = new spine.Vector2();
  spSkeleton.getBounds(offset, size, []);

  camBaseX = offset.x + size.x / 2;
  camBaseY = offset.y + size.y / 2;

  resize();

  // Arrancar el loop solo si no está corriendo ya
  if (!loopRunning) {
    loopRunning = true;
    requestAnimationFrame(loop);
  }
}


// ================================================================
//  LOOP DE RENDERIZADO
//  Usa requestAnimationFrame para renderizar continuamente.
// ================================================================
function loop() {
  if (!spRenderer || !spSkeleton || !spAnimState) {
    requestAnimationFrame(loop);
    return;
  }

  const now   = Date.now() / 1000;
  const delta = now - lastTime;
  lastTime    = now;

  spAnimState.update(delta * speed);
  spAnimState.apply(spSkeleton);
  spSkeleton.updateWorldTransform();

  spRenderer.camera.position.set(
    camBaseX - offsetX,
    camBaseY - offsetY,
    0
  );
  spRenderer.camera.zoom = 1 / (baseScale * userZoom);

  const gl = spCtx.gl;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  spRenderer.begin();
  spRenderer.drawSkeleton(spSkeleton, true);
  spRenderer.end();

  requestAnimationFrame(loop);
}


// ================================================================
//  CONTROL DE ANIMACIONES
// ================================================================

function setAnimation(name) {
  if (!spAnimState) return;
  curAnim = name;
  spAnimState.setAnimation(0, name, looping);
  localStorage.setItem("lastAnim_" + currentCharacter + "_" + currentModelKey, name);
}

// Avanza a la siguiente animación de la lista (circular)
function nextAnim() {
  if (!animList.length) return;
  animIndex = (animIndex + 1) % animList.length;
  setAnimation(animList[animIndex]);
  updateAnimActive();
}

// Retrocede a la animación anterior de la lista (circular)
function prevAnim() {
  if (!animList.length) return;
  animIndex = (animIndex - 1 + animList.length) % animList.length;
  setAnimation(animList[animIndex]);
  updateAnimActive();
}


// ================================================================
//  FONDO
//  Aplica imagen (custom o predefinida) y ajuste de tamaño.
// ================================================================

// Aplica el fondo activo: custom tiene prioridad sobre predefinido
function applyBackground() {
  const bg = document.getElementById("bg");
  if (customBgUrl) {
    bg.style.backgroundImage = `url("${customBgUrl}")`;
  } else {
    bg.style.backgroundImage = `url("${BG_MAP[currentBgKey]}")`;
  }
}

// Aplica el ajuste de tamaño y posición del fondo
function applyBgFit(fit) {
  const bg = document.getElementById("bg");
  switch (fit) {
    case "cover":
      bg.style.backgroundSize     = "cover";
      bg.style.backgroundPosition = "center";
      bg.style.backgroundRepeat   = "no-repeat";
      break;
    case "contain":
      bg.style.backgroundSize     = "contain";
      bg.style.backgroundPosition = "center";
      bg.style.backgroundRepeat   = "no-repeat";
      break;
    case "stretch":
      bg.style.backgroundSize     = "100% 100%";
      bg.style.backgroundPosition = "center";
      bg.style.backgroundRepeat   = "no-repeat";
      break;
    case "center":
      bg.style.backgroundSize     = "auto";
      bg.style.backgroundPosition = "center";
      bg.style.backgroundRepeat   = "no-repeat";
      break;
    case "repeat":
      bg.style.backgroundSize     = "auto";
      bg.style.backgroundPosition = "top left";
      bg.style.backgroundRepeat   = "repeat";
      break;
  }
}


// ================================================================
//  CARGA DE MODELO SPINE
//  Con caché para no re-descargar modelos ya visitados.
// ================================================================
async function loadModel(model) {
  try {
    const cacheKey = model.skel;
    let cached = modelCache.get(cacheKey);

    if (!cached) {
      const skel    = await fetch(model.skel).then(r => r.arrayBuffer());
      const atlas   = await fetch(model.atlas).then(r => r.text());
      const pngBlob = await fetch(model.png).then(r => r.blob());

      const img = await new Promise((resolve) => {
        const i  = new Image();
        i.onload = () => resolve(i);
        i.src    = URL.createObjectURL(pngBlob);
      });

      cached = { skel, atlas, img };

      if (modelCacheOrder.length >= MODEL_CACHE_LIMIT) {
        const oldest = modelCacheOrder.shift();
        const old    = modelCache.get(oldest);
        if (old && old.img.src.startsWith("blob:")) {
          URL.revokeObjectURL(old.img.src);
        }
        modelCache.delete(oldest);
      }

      modelCache.set(cacheKey, cached);
      modelCacheOrder.push(cacheKey);
    }

    // Transición: fade out → reinicializar → fade in con slide
    const canvas = document.getElementById("c");
    canvas.style.transition = "opacity 0.2s ease";
    canvas.style.opacity    = 0;

    setTimeout(() => {
      spSkeleton  = null;
      spAnimState = null;
      animList    = [];
      animIndex   = 0;

      canvas.style.transform = "translateX(50px)";
      canvas.style.opacity   = 0;

      initSpine(cached.skel, cached.atlas, cached.img);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          canvas.style.transition = "opacity 0.3s ease, transform 0.3s ease";
          canvas.style.opacity    = 1;
          canvas.style.transform  = "translateX(0)";
        });
      });
    }, 200);

  } catch (e) {
    console.error("Error cargando modelo:", e);
    // Restaurar opacity si falla
    const canvas = document.getElementById("c");
    canvas.style.opacity = 1;
  }
}


// ================================================================
//  CARGA DE CONFIGURACIÓN DE PERSONAJES
// ================================================================
async function loadCharactersConfig() {
  try {
    const data = await fetch("assets/characters.json");
    characters = await data.json();
  } catch (e) {
    console.error("Error cargando characters.json:", e);
    alert("Error cargando configuración de personajes. Revisa la consola para más detalles.");
    characters = {}; // Fallback vacío
  }
}


// ================================================================
//  DRAG TO SCROLL
//  Permite hacer scroll en listas arrastrando con el mouse.
// ================================================================
function enableDragScroll(element) {
  // Añadir mousedown al element
  element.addEventListener("mousedown", (e) => {
    if (element.dataset.isDragging === "true") return;
    element.dataset.isDragging = "true";
    element.dataset.startY = e.clientY.toString();
    element.dataset.startScroll = element.scrollTop.toString();
    element.style.cursor = "grabbing";
    element.dataset.dragged = "false";
    e.preventDefault();
  });

  if (!dragScrollInitialized) {
    dragScrollInitialized = true;
    document.addEventListener("mousemove", (e) => {
      const draggingElement = document.querySelector('[data-is-dragging="true"]');
      if (!draggingElement) return;
      const startY = parseFloat(draggingElement.dataset.startY);
      const startScroll = parseFloat(draggingElement.dataset.startScroll);
      const delta = e.clientY - startY;
      if (Math.abs(delta) > 5) {
        draggingElement.dataset.dragged = "true";
      }
      draggingElement.scrollTop = startScroll - delta;
      e.preventDefault(); // Evita selección de texto durante drag
    });

    document.addEventListener("mouseup", () => {
      const draggingElement = document.querySelector('[data-is-dragging="true"]');
      if (draggingElement) {
        draggingElement.dataset.isDragging = "false";
        draggingElement.style.cursor = "grab";
      }
    });
  }

  element.style.cursor = "grab";
}


// ================================================================
//  UI: LISTA DE PERSONAJES
// ================================================================
function buildCharacterList() {
  const container = document.getElementById("charList");
  const savedChar = localStorage.getItem("lastCharacter");
  container.innerHTML = "";

  // Ordenar las claves por el campo `order` del JSON
  const keys = Object.keys(characters).sort((a, b) => {
    return (characters[a].order || 0) - (characters[b].order || 0);
  });

  let activeCharDiv = null;

  keys.forEach(key => {
    const char = characters[key];

    const div = document.createElement("div");
    div.className = "charCard";

    // Marcar como seleccionado si coincide con el último guardado
    if (key === savedChar)       div.classList.add("selected");
    if (key === currentCharacter) {
      div.classList.add("active");
      activeCharDiv = div;  // Guardar referencia al personaje activo
    }

    // Usar el modelo guardado para este personaje, o el primero disponible
    let saved    = JSON.parse(localStorage.getItem("lastModels") || "{}");
    let modelKey = saved[key];
    let model    = (modelKey && char.models[modelKey])
                 ? char.models[modelKey]
                 : Object.values(char.models)[0];

    // El ícono puede venir del modelo específico o del personaje padre
    const icon  = model.icon || char.icon;
    const scale = 70 / 100;

    // Recortar el sprite sheet a la posición correcta del ícono
    div.style.backgroundImage    = `url(${icon.sheet})`;
    div.style.backgroundPosition = `-${icon.x * scale}px -${icon.y * scale}px`;
    div.style.backgroundRepeat   = "no-repeat";
    div.style.backgroundSize     = `${2048 * scale}px ${2048 * scale}px`;

    // Al clickear: seleccionar este personaje
    div.onclick = (e) => {
          // Si venimos de un drag, ignorar el click
          const list = document.getElementById("charList");
          if (list.dataset.dragged === "true") return;
          selectCharacter(key);
        };

    // Al pasar el mouse: mostrar nombre del personaje en el título
    div.onmouseenter = () => { setMenuTitle(char.name); };
    div.onmouseleave = () => { setMenuTitle(""); };

    container.appendChild(div);
  });
  container.onmouseleave = () => { setMenuTitle("Heroes"); };
  enableDragScroll(container);

  // Restaurar la última posición del scroll guardada
  const savedScroll = localStorage.getItem("charListScroll");
  if (savedScroll) {
    container.scrollTop = parseInt(savedScroll, 10);
  }

  // Guardar posición del scroll cuando cambia
  container.addEventListener("scroll", () => {
    localStorage.setItem("charListScroll", container.scrollTop);
  });

  // Si hay un personaje activo, hacerlo visible
  if (activeCharDiv) {
    setTimeout(() => {
      activeCharDiv.scrollIntoView({ behavior: "auto", block: "nearest" });
      localStorage.setItem("charListScroll", container.scrollTop);
    }, 0);
  }
}


// ================================================================
//  UI: LISTA DE MODELOS (ARMARIO)
// ================================================================
function buildModelList(charKey) {
  const container = document.getElementById("modelList");
  container.innerHTML = "";

  const models  = characters[charKey].models;
  const saved   = JSON.parse(localStorage.getItem("lastModels") || "{}");
  const activeModelKey = saved[charKey] || Object.keys(models)[0];

  Object.keys(models).forEach(key => {
    const model = models[key];

    const div = document.createElement("div");
    div.className = "charCard";

    // Marcar el modelo actualmente seleccionado
    if (key === activeModelKey) div.classList.add("modelSelected");

    const icon  = model.icon;
    const scale = 70 / 100;

    div.style.backgroundImage    = `url(${icon.sheet})`;
    div.style.backgroundPosition = `-${icon.x * scale}px -${icon.y * scale}px`;
    div.style.backgroundRepeat   = "no-repeat";
    div.style.backgroundSize     = `${2048 * scale}px ${2048 * scale}px`;

    div.onclick = () => {
      currentModelKey = key;
      loadModel(model);

      saved[charKey] = key;
      localStorage.setItem("lastModels", JSON.stringify(saved));

      buildCharacterList();
      buildModelList(charKey);   // Redibujar para actualizar el modelSelected
    };

    div.onmouseenter = () => { setMenuTitle(model.name); };
    div.onmouseleave = () => { setMenuTitle(""); };

    container.appendChild(div);
  });

  container.onmouseleave = () => { setMenuTitle("Modelos"); };
}


// ================================================================
//  LISTA DE ANIMACIONES
//  Se muestra debajo de las tarjetas de modelos en el armario.
//  Se reconstruye al cambiar de modelo o de animación.
// ================================================================
function buildAnimList() {
  const section = document.getElementById("animSection");
  if (!section) return;

  const style = window.getComputedStyle(section);
  const rect = section.getBoundingClientRect();
  
  section.innerHTML = "";

  if (!animList || animList.length === 0) {
    return;
  }

  const modelList = document.getElementById("modelList");
  if (modelList && modelList.classList.contains("visibleView")) {
    section.classList.add("visibleView");
    section.classList.remove("hiddenView");
    document.getElementById("AnimTitle")?.classList.add("visibleView");
    document.getElementById("AnimTitle")?.classList.remove("hiddenView");
  } else {
    section.classList.add("hiddenView");
    section.classList.remove("visibleView");
    document.getElementById("AnimTitle")?.classList.add("hiddenView");
    document.getElementById("AnimTitle")?.classList.remove("visibleView");
  }

  animList.forEach((name, index) => {
    const item = document.createElement("div");
    item.className = "animItem";
    if (index === animIndex) item.classList.add("active");
    item.innerText = name;

    item.onclick = () => {
      setAnimation(name);
      animIndex = index;
      updateAnimActive();
    };

    section.appendChild(item);
  });

  enableDragScroll(section);
}


// ================================================================
//  ACTUALIZAR ANIMACIÓN ACTIVA
//  Actualiza la clase 'active' en los items de animación sin reconstruir la lista.
// ================================================================
function updateAnimActive() {
  const items = document.querySelectorAll('.animItem');
  items.forEach((item, index) => {
    if (index === animIndex) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}


// ================================================================
//  SELECCIÓN DE PERSONAJE
// ================================================================
function selectCharacter(key) {
  currentCharacter = key;
  localStorage.setItem("lastCharacter", key);

  buildCharacterList();
  buildModelList(key);

  let saved    = JSON.parse(localStorage.getItem("lastModels") || "{}");
  let modelKey = saved[key];

  if (modelKey && characters[key].models[modelKey]) {
    currentModelKey = modelKey;
    loadModel(characters[key].models[modelKey]);
  } else {
    const firstKey = Object.keys(characters[key].models)[0];
    const firstModel = characters[key].models[firstKey];
    saved[key] = firstKey;
    localStorage.setItem("lastModels", JSON.stringify(saved));
    currentModelKey = firstKey;
    loadModel(firstModel);
  }
}


// ================================================================
//  VISTAS DEL MENÚ: PERSONAJES / ARMARIO
// ================================================================
function showCharacters() {
  document.getElementById("modelList").classList.remove("visibleView");
  document.getElementById("modelList").classList.add("hiddenView");
  document.getElementById("charList").classList.remove("hiddenView");
  document.getElementById("charList").classList.add("visibleView");
  const animSection = document.getElementById("animSection");
  if (animSection) {
    animSection.classList.remove("visibleView");
    animSection.classList.add("hiddenView");
  }

  const AnimTitle = document.getElementById("AnimTitle");
  if (AnimTitle) {
    AnimTitle.classList.remove("visibleView");
    AnimTitle.classList.add("hiddenView");
  }
  document.getElementById("listsWrapper").style.transform = "translateX(0%)";
  setMenuTitle("Heroes");
}

function showWardrobe() {
  document.getElementById("modelList").classList.remove("hiddenView");
  document.getElementById("modelList").classList.add("visibleView");
  document.getElementById("charList").classList.remove("visibleView");
  document.getElementById("charList").classList.add("hiddenView");
  const animSection = document.getElementById("animSection");
  if (animSection) {
    animSection.classList.remove("hiddenView");
    animSection.classList.add("visibleView");
  }

  const AnimTitle = document.getElementById("AnimTitle");
  if (AnimTitle) {
    AnimTitle.classList.remove("hiddenView");
    AnimTitle.classList.add("visibleView");
  }
  document.getElementById("listsWrapper").style.transform = "translateX(-100%)";
  buildModelList(currentCharacter);
  setMenuTitle("Armario");
}


// ================================================================
//  TÍTULO DEL MENÚ
// ================================================================
const menuTitle = document.getElementById("menuTitle");

function setMenuTitle(text) {
  if (!menuTitle) return;
  menuTitle.style.opacity = 0;
  setTimeout(() => {
    menuTitle.innerText     = text;
    menuTitle.style.opacity = 1;
  }, 100);
}


// ================================================================
//  PANEL DE AJUSTES
//  Conecta cada control del panel con su variable y la persiste
//  en localStorage para restaurarla al recargar.
// ================================================================
function initSettingsPanel() {
  const panel      = document.getElementById("settingsPanel");
  const settingBtn = document.getElementById("settingsBtn");

  // --- Abrir / cerrar panel ---
  settingBtn.onclick = () => {
    const isOpen = panel.classList.toggle("open");
    settingBtn.textContent = isOpen ? "✕" : "⚙";
  };

  // --- Helpers ---
  // Lee un valor de localStorage y lo aplica al input correspondiente
  function restoreInput(id, storageKey, defaultVal) {
    const el  = document.getElementById(id);
    const val = localStorage.getItem(storageKey);
    if (val !== null) el.value = val;
    else el.value = defaultVal;
    return el;
  }

  function restoreCheck(id, storageKey, defaultVal) {
    const el  = document.getElementById(id);
    const val = localStorage.getItem(storageKey);
    el.checked = val !== null ? val === "true" : defaultVal;
    return el;
  }

  // --- Fondo predefinido ---
  const bgSel = document.getElementById("cfg-background");
  currentBgKey = localStorage.getItem("cfg-background") || "bg1";
  populateBgSelect();
  bgSel.value = currentBgKey;
  bgSel.onchange = () => {
    currentBgKey = bgSel.value;
    localStorage.setItem("cfg-background", currentBgKey);
    applyBackground();
  };

  // --- Fondo personalizado ---
  const customInput   = document.getElementById("cfg-customBgInput");
  const customBtn     = document.getElementById("cfg-customBgBtn");
  const customClear   = document.getElementById("cfg-customBgClear");
  const customName    = document.getElementById("cfg-customBgName");

  // En standalone no podemos persistir el archivo entre sesiones (no hay ruta de WE),
  // así que el file picker siempre empieza vacío al recargar.
  customBtn.onclick = () => customInput.click();

  customInput.onchange = () => {
    const file = customInput.files[0];
    if (!file) return;

    // Liberar el blob anterior si había uno
    if (customBgUrl) URL.revokeObjectURL(customBgUrl);

    customBgUrl       = URL.createObjectURL(file);
    customName.innerText = file.name;
    applyBackground();
  };

  customClear.onclick = () => {
    if (customBgUrl) URL.revokeObjectURL(customBgUrl);
    customBgUrl          = null;
    customInput.value    = "";
    customName.innerText = "Ninguna";
    applyBackground();
  };

  // --- Ajuste del fondo ---
  const bgFitSel = restoreInput("cfg-bgFit", "cfg-bgFit", "cover");
  currentBgFit   = bgFitSel.value;
  applyBgFit(currentBgFit);
  bgFitSel.onchange = () => {
    currentBgFit = bgFitSel.value;
    localStorage.setItem("cfg-bgFit", currentBgFit);
    applyBgFit(currentBgFit);
  };

  // --- Velocidad ---
  const speedEl    = restoreInput("cfg-speed", "cfg-speed", 1);
  const speedValEl = document.getElementById("cfg-speedVal");
  speed            = parseFloat(speedEl.value);
  speedValEl.innerText = parseFloat(speedEl.value).toFixed(1);
  speedEl.oninput = () => {
    speed = parseFloat(speedEl.value);
    speedValEl.innerText = speed.toFixed(1);
    localStorage.setItem("cfg-speed", speed);
  };

  // --- Zoom ---
  const zoomEl    = restoreInput("cfg-zoom", "cfg-zoom", 1);
  const zoomValEl = document.getElementById("cfg-zoomVal");
  userZoom        = parseFloat(zoomEl.value);
  zoomValEl.innerText = parseFloat(zoomEl.value).toFixed(1);
  zoomEl.oninput = () => {
    userZoom = parseFloat(zoomEl.value);
    zoomValEl.innerText = userZoom.toFixed(1);
    localStorage.setItem("cfg-zoom", userZoom);
  };

  // --- Restaurar posición almacenada ---
  const storedPosX = localStorage.getItem("cfg-posx");
  const storedPosY = localStorage.getItem("cfg-posy");
  if (storedPosX !== null) offsetX = parseFloat(storedPosX);
  if (storedPosY !== null) offsetY = parseFloat(storedPosY);

  // --- Loop de animación ---
  const loopEl = restoreCheck("cfg-loop", "cfg-loop", true);
  looping      = loopEl.checked;
  loopEl.onchange = () => {
    looping = loopEl.checked;
    localStorage.setItem("cfg-loop", looping);
    if (curAnim && spAnimState) {
      spAnimState.setAnimation(0, curAnim, looping);
    }
  };

  // --- Volumen ---
  const volumeEl    = restoreInput("cfg-volume", "cfg-volume", 0.5);
  const volumeValEl = document.getElementById("cfg-volumeVal");
  volume            = parseFloat(volumeEl.value);
  volumeValEl.innerText = Math.round(volume * 100) + "%";
  if (music) music.volume = volume; // Aplicar volumen restaurado
  volumeEl.oninput = () => {
    volume = parseFloat(volumeEl.value);
    volumeValEl.innerText = Math.round(volume * 100) + "%";
    localStorage.setItem("cfg-volume", volume);
    if (music) music.volume = volume;
  };
}

function initDragToMove() {
  const canvas = document.getElementById("c");
  if (!canvas) return;

  let dragging      = false;
  let startX        = 0;
  let startY        = 0;
  let startOffsetX  = 0;
  let startOffsetY  = 0;

  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startOffsetX = offsetX;
    startOffsetY = offsetY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    offsetX = startOffsetX + dx;
    offsetY = startOffsetY - dy;
    localStorage.setItem("cfg-posx", offsetX);
    localStorage.setItem("cfg-posy", offsetY);
  });

  const stopDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = "grab";
    if (e.pointerId) canvas.releasePointerCapture(e.pointerId);
  };

  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
  canvas.addEventListener("pointerleave", stopDrag);
}


// ================================================================
//  INICIO DE LA APLICACIÓN (window.onload)
// ================================================================
window.onload = async () => {

  // Fondo por defecto
  document.getElementById("bg").style.backgroundImage = `url('${BG_MAP["bg1"]}')`;

  // Cargar personajes y construir lista
  await loadCharactersConfig();
  buildCharacterList();

  // Decidir qué personaje cargar al inicio
  const savedChar = localStorage.getItem("lastCharacter");

  // Eliminado: randomOnStart check
  if (savedChar && characters[savedChar]) {
    selectCharacter(savedChar);                       // Último guardado
  } else {
    const firstChar = Object.keys(characters)[0];
    selectCharacter(firstChar);                       // Primero de la lista
  }

  // --- Menú lateral de personajes ---
  const menu      = document.getElementById("sideMenu");
  const toggleBtn = document.getElementById("toggleBtn");

  toggleBtn.onclick = () => {
    menu.classList.toggle("open");
    const isOpen = menu.classList.contains("open");
    toggleBtn.innerText = isOpen ? "◀" : "▶";

    const controls = document.getElementById("controls");
    if (isOpen) {
      controls.classList.add("visible");
    } else {
      controls.classList.remove("visible");
    }
  };

  // --- Audio ---
  music        = new Audio("assets/audio/music.wav");
  music.loop   = true;
  // music.volume se setea en initSettingsPanel después de restaurar

  // Intentar autoplay, si falla esperar el primer click del usuario
  const tryPlay = () => {
    music.play().then(() => {
      document.removeEventListener("click", tryPlay);
    }).catch(() => {});
  };

  music.play().catch(() => {
    // Autoplay bloqueado: arrancar en el primer click en cualquier parte
    document.addEventListener("click", tryPlay);
  });

  // --- Botones del menú ---
  document.getElementById("wardrobeBtn").onclick = () => {
    const modelList = document.getElementById("modelList");
    if (modelList.classList.contains("visibleView")) {
      showCharacters();
    } else {
      showWardrobe();
    }
  };

  // Ocultar modelList al inicio
  document.getElementById("modelList").classList.add("hiddenView");
  document.getElementById("AnimTitle")?.classList.add("hiddenView");
  document.getElementById("animSection")?.classList.add("hiddenView");

  
  // --- Inicializar panel de ajustes ---
  initSettingsPanel();
  initDragToMove();

  // --- Inicializar botones de animación ---
  document.getElementById("controls").querySelector("button:first-child").onclick = prevAnim;
  document.getElementById("controls").querySelector("button:last-child").onclick = nextAnim;

  // Aplicar fondo guardado
  applyBackground();

  resize();

  // Añadir listener para resize
  window.addEventListener("resize", resize);
};
