// ============================================================
//  BOMBERMAN 1v1 ONLINE
//  Phaser 3 + Supabase Realtime Broadcast
//  Sprites reales + 5 mapas + portrait/landscape + 4 personajes
// ============================================================

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://lcnkqybqowiycppialvl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjbmtxeWJxb3dpeWNwcGlhbHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjM5MTQsImV4cCI6MjA5MDM5OTkxNH0.VNwwWHzny7y7b6IdYqeoMyRW3dNXDUVaWHXHMxiHaPo';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
//  DETECCION DE DISPOSITIVO Y PANTALLA
// ============================================================
const ES_MOVIL = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (window.innerWidth < 900 && 'ontouchstart' in window);
const SCREEN_W = window.innerWidth;
const SCREEN_H = window.innerHeight;
const ES_PORTRAIT = SCREEN_H > SCREEN_W;

// Recargar al rotar para recalcular layout
window.addEventListener('orientationchange', () => setTimeout(() => location.reload(), 400));

// ============================================================
//  CONSTANTES BASE
// ============================================================
const TILE_BASE = 48;
const COLS = 15;
const ROWS = 13;
const BOMB_TIMER = 2500;
const EXPLOSION_DURATION = 500;
const BASE_SPEED = 150;
const SPEED_BOOST = 30;
const SYNC_INTERVAL = 50;

// Nombres y colores de los 4 personajes
const PERSONAJES = [
    { nombre: 'Bomber',  color: '#e94560' },
    { nombre: 'Dark',    color: '#cc44ff' },
    { nombre: 'Astro',   color: '#ffcc00' },
    { nombre: 'Classic', color: '#4488ff' },
];

// Nombres de los 5 mapas
const MAPAS_NOMBRES = ['Clasico', 'Ruinas', 'Industrial', 'Bosque', 'Templo'];

// Estado global
let estadoGlobal = {
    idSala: null,
    nombreJugador: '',
    numJugador: null,
    canal: null,
    personaje: 0,
    personajeRival: 0,
    selectedMap: 0
};

// ============================================================
//  CALCULO DE LAYOUT RESPONSIVE
// ============================================================
function calcLayout(W, H) {
    let tile, offX, offY;

    if (!ES_MOVIL) {
        // Desktop: panel izquierdo 280px
        tile = 48;
        offX = 280;
        offY = 48;
    } else if (ES_PORTRAIT) {
        // Portrait: grid llena el ancho
        tile = Math.floor((W - 16) / COLS);
        offX = Math.floor((W - tile * COLS) / 2);
        offY = 42;
    } else {
        // Landscape mobile: grid llena el alto disponible
        tile = Math.max(20, Math.floor((H - 42) / ROWS));
        offX = 8;
        offY = Math.floor((H - tile * ROWS) / 2 + 4);
    }

    tile = Math.max(16, Math.min(tile, 48));
    return { W, H, tile, offX, offY };
}

// ============================================================
//  GENERADOR DE RANDOM CON SEMILLA
// ============================================================
function seededRandom(seed) {
    let s = Math.abs(seed) || 1;
    return function () {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

// ============================================================
//  GENERADOR DE MAPA — 5 tipos
//  fullSeed = timestamp * 10 + mapType  (mapType 0-4)
// ============================================================
function generarMapa(fullSeed) {
    const mapType = fullSeed % 10;
    const actualSeed = Math.floor(fullSeed / 10);
    const rand = seededRandom(actualSeed);
    const mapa = [];
    const powerups = {};

    // Paredes base
    for (let y = 0; y < ROWS; y++) {
        mapa[y] = [];
        for (let x = 0; x < COLS; x++) {
            if (y === 0 || y === ROWS - 1 || x === 0 || x === COLS - 1) mapa[y][x] = 1;
            else if (x % 2 === 0 && y % 2 === 0) mapa[y][x] = 1;
            else mapa[y][x] = 0;
        }
    }

    // Zonas de spawn siempre libres
    const safe = [
        [1, 1], [2, 1], [1, 2],
        [COLS - 2, ROWS - 2], [COLS - 3, ROWS - 2], [COLS - 2, ROWS - 3]
    ];

    // Densidad por tipo de mapa
    const densidades = [0.65, 0.48, 0.78, 0.62, 0.72];
    const density = densidades[mapType];

    // Zonas despejadas especiales segun mapa
    const clearSet = new Set();

    if (mapType === 3) {
        // Bosque: caminos en cruz central
        for (let y = 1; y < ROWS - 1; y++) if (mapa[y][7] === 0) clearSet.add(`7,${y}`);
        for (let x = 1; x < COLS - 1; x++) if (mapa[6][x] === 0) clearSet.add(`${x},6`);
    }
    if (mapType === 4) {
        // Templo: corredores horizontales
        for (let x = 1; x < COLS - 1; x++) {
            if (mapa[3][x] === 0) clearSet.add(`${x},3`);
            if (mapa[9][x] === 0) clearSet.add(`${x},9`);
        }
    }
    if (mapType === 1) {
        // Ruinas: zona central abierta
        for (let y = 4; y <= 8; y++)
            for (let x = 5; x <= 9; x++)
                if (mapa[y][x] === 0) clearSet.add(`${x},${y}`);
    }

    // Colocar bloques
    for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
            if (mapa[y][x] !== 0) continue;
            if (safe.some(([cx, cy]) => cx === x && cy === y)) continue;
            if (clearSet.has(`${x},${y}`)) continue;

            if (rand() < density) {
                mapa[y][x] = 2;
                if (rand() < 0.30) {
                    const r2 = rand();
                    const tipo = r2 < 0.30 ? 'bomb' : r2 < 0.60 ? 'fire' : r2 < 0.85 ? 'speed' : 'kick';
                    powerups[x + ',' + y] = tipo;
                }
            }
        }
    }

    return { mapa, powerups, mapType };
}

// ============================================================
//  FUNCIONES SUPABASE
// ============================================================
async function crearSala(id, nombre, fullSeed, personaje) {
    const { error } = await sbClient.from('salas').insert({
        id, estado: 'esperando',
        timer_inicio: fullSeed,
        jugador1: { nombre, personaje },
        jugador2: null
    });
    if (error) throw error;
}

async function unirseASala(id, nombre, personaje) {
    const { error } = await sbClient.from('salas').update({
        jugador2: { nombre, personaje },
        estado: 'jugando'
    }).eq('id', id);
    if (error) throw error;
}

async function leerSala(id) {
    const { data, error } = await sbClient.from('salas').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;  // null si no existe
}

function escucharSala(id, callback) {
    return sbClient.channel('db_' + id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'salas', filter: 'id=eq.' + id },
            (payload) => { if (payload.new) callback(payload.new); })
        .subscribe();
}

function crearCanalJuego(idSala) {
    const canal = sbClient.channel('game_' + idSala, { config: { broadcast: { self: false } } });
    estadoGlobal.canal = canal;
    return canal;
}

function broadcast(evento, datos) {
    if (estadoGlobal.canal)
        estadoGlobal.canal.send({ type: 'broadcast', event: evento, payload: datos });
}

function generarIdSala() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 5; i++) id += c[Math.floor(Math.random() * c.length)];
    return id;
}

// ============================================================
//  CHROMA KEY — Elimina fondo verde de sprites
//  Usa createCanvas + refresh (compatible con WebGL)
// ============================================================
function aplicarChromaKey(scene, sourceKey, destKey) {
    try {
        const srcTex = scene.textures.get(sourceKey);
        // Verificar que la textura cargo correctamente
        if (!srcTex || srcTex.key === '__MISSING') {
            console.warn('Textura no encontrada:', sourceKey);
            return false;
        }
        const src = srcTex.getSourceImage();
        if (!src || src.width === 0) {
            console.warn('Imagen vacia:', sourceKey);
            return false;
        }

        // Crear canvas temporal para manipular pixeles
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = src.width;
        tempCanvas.height = src.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(src, 0, 0);
        const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            if (g > 80 && g > r * 1.4 && g > b * 1.4 && (g - r) > 40 && (g - b) > 40)
                d[i + 3] = 0;
        }
        tempCtx.putImageData(imgData, 0, 0);

        // Usar createCanvas de Phaser (compatible con WebGL)
        if (scene.textures.exists(destKey)) scene.textures.remove(destKey);
        const phaserTex = scene.textures.createCanvas(destKey, tempCanvas.width, tempCanvas.height);
        phaserTex.context.drawImage(tempCanvas, 0, 0);
        phaserTex.refresh();
        return true;
    } catch (e) {
        console.error('Error chroma key:', sourceKey, e);
        return false;
    }
}

// Verificar si una textura es valida (no es la de "missing")
function texturaValida(scene, key) {
    if (!scene.textures.exists(key)) return false;
    const tex = scene.textures.get(key);
    return tex && tex.key !== '__MISSING';
}

// Generar textura de personaje de respaldo (programatica)
function generarPersonajeFallback(scene, key, colorCuerpo, colorAccento) {
    const g = scene.make.graphics({ add: false });
    const T = TILE_BASE;
    g.clear();
    // Cuerpo
    g.fillStyle(colorAccento);
    g.fillRect(12, 22, 24, 18);
    // Cabeza
    g.fillStyle(colorCuerpo);
    g.fillCircle(T / 2, 16, 12);
    // Ojos
    g.fillStyle(0x000000);
    g.fillRect(18, 12, 4, 5);
    g.fillRect(26, 12, 4, 5);
    g.fillStyle(0xffffff);
    g.fillRect(19, 13, 2, 2);
    g.fillRect(27, 13, 2, 2);
    // Antena
    g.fillStyle(colorAccento);
    g.fillRect(22, 0, 4, 8);
    g.fillCircle(T / 2, 2, 4);
    // Pies
    g.fillStyle(0x222222);
    g.fillRect(14, 40, 8, 6);
    g.fillRect(26, 40, 8, 6);
    // Cinturon
    g.fillStyle(colorCuerpo);
    g.fillRect(12, 30, 24, 3);
    g.generateTexture(key, T, T);
    g.destroy();
}

// Colores fallback para los 4 personajes
const CHAR_FALLBACK_COLORS = [
    { cuerpo: 0xe94560, accento: 0xcc2244 },  // Bomber (rojo)
    { cuerpo: 0x333333, accento: 0xcc44ff },  // Dark (morado)
    { cuerpo: 0xffcc00, accento: 0xdd9900 },  // Astro (amarillo)
    { cuerpo: 0xffffff, accento: 0x4488ff },  // Classic (azul)
];

// ============================================================
//  TEXTURAS PIXEL ART PROGRAMATICAS
// ============================================================
function generarTexturas(scene) {
    const g = scene.make.graphics({ add: false });
    const T = TILE_BASE;

    // PISO
    g.clear();
    g.fillStyle(0x3d8b37); g.fillRect(0, 0, T, T);
    g.fillStyle(0x2d7a2d); g.fillRect(0, 0, T / 2, T / 2); g.fillRect(T / 2, T / 2, T / 2, T / 2);
    g.lineStyle(1, 0x4a9e44, 0.3); g.strokeRect(1, 1, T - 2, T - 2);
    g.generateTexture('floor', T, T);

    // MURO
    g.clear();
    g.fillStyle(0x555566); g.fillRect(0, 0, T, T);
    g.fillStyle(0x666677);
    g.fillRect(2, 2, 20, 10); g.fillRect(26, 2, 20, 10);
    g.fillRect(14, 16, 20, 10); g.fillRect(2, 30, 20, 10); g.fillRect(26, 30, 20, 10);
    g.lineStyle(1, 0x444455);
    g.lineBetween(0, 14, T, 14); g.lineBetween(0, 28, T, 28); g.lineBetween(0, 42, T, 42);
    g.lineBetween(24, 0, 24, 14); g.lineBetween(12, 14, 12, 28); g.lineBetween(36, 14, 36, 28);
    g.lineStyle(2, 0x3d3d4e); g.strokeRect(0, 0, T, T);
    g.generateTexture('wall', T, T);

    // BLOQUE
    g.clear();
    g.fillStyle(0xbb8844); g.fillRect(0, 0, T, T);
    g.fillStyle(0xcc9955); g.fillRect(3, 3, T - 6, T - 6);
    g.fillStyle(0xddaa66); g.fillRect(6, 6, T - 12, T - 12);
    g.lineStyle(2, 0xaa7733); g.lineBetween(T / 2, 4, T / 2, T - 4); g.lineBetween(4, T / 2, T - 4, T / 2);
    g.lineStyle(2, 0x996633); g.strokeRect(0, 0, T, T);
    g.generateTexture('block', T, T);

    // BOMBA
    g.clear();
    g.fillStyle(0x222222); g.fillCircle(T / 2, T / 2 + 4, 16);
    g.fillStyle(0x333333); g.fillCircle(T / 2, T / 2 + 4, 13);
    g.fillStyle(0x666666); g.fillCircle(T / 2 - 5, T / 2 - 1, 4);
    g.lineStyle(3, 0x886644); g.lineBetween(T / 2, T / 2 - 10, T / 2 + 6, T / 2 - 18);
    g.fillStyle(0xff6600); g.fillCircle(T / 2 + 6, T / 2 - 18, 4);
    g.fillStyle(0xffcc00); g.fillCircle(T / 2 + 6, T / 2 - 18, 2);
    g.generateTexture('bomb', T, T);

    // EXPLOSION CENTRO
    g.clear();
    g.fillStyle(0xff4400); g.fillRect(4, 4, T - 8, T - 8);
    g.fillStyle(0xff8800); g.fillRect(8, 8, T - 16, T - 16);
    g.fillStyle(0xffcc00); g.fillRect(14, 14, T - 28, T - 28);
    g.fillStyle(0xffffff); g.fillRect(18, 18, T - 36, T - 36);
    g.generateTexture('exp_center', T, T);

    // EXPLOSION HORIZONTAL
    g.clear();
    g.fillStyle(0xff4400); g.fillRect(0, 8, T, T - 16);
    g.fillStyle(0xff8800); g.fillRect(0, 12, T, T - 24);
    g.fillStyle(0xffcc00); g.fillRect(0, 16, T, T - 32);
    g.generateTexture('exp_h', T, T);

    // EXPLOSION VERTICAL
    g.clear();
    g.fillStyle(0xff4400); g.fillRect(8, 0, T - 16, T);
    g.fillStyle(0xff8800); g.fillRect(12, 0, T - 24, T);
    g.fillStyle(0xffcc00); g.fillRect(16, 0, T - 32, T);
    g.generateTexture('exp_v', T, T);

    // POWER-UPS
    dibujarPowerup(g, 0x9944cc, 'pu_bomb');
    dibujarPowerup(g, 0xe94560, 'pu_fire');
    dibujarPowerup(g, 0x4488ff, 'pu_speed');
    dibujarPowerup(g, 0x44bb44, 'pu_kick');

    // TUMBA
    g.clear();
    g.fillStyle(0x666666); g.fillRect(16, 20, 16, 24); g.fillRect(10, 20, 28, 6);
    g.fillStyle(0x888888); g.fillRect(18, 22, 12, 20);
    g.generateTexture('tumba', T, T);

    // BORDE SELECCION
    g.clear();
    g.lineStyle(4, 0xffcc00); g.strokeRect(2, 2, T - 4, T - 4);
    g.lineStyle(2, 0xff8800); g.strokeRect(6, 6, T - 12, T - 12);
    g.generateTexture('sel_border', T, T);

    g.destroy();
}

function dibujarPowerup(g, color, key) {
    const T = TILE_BASE;
    g.clear();
    g.fillStyle(0x000000); g.fillRect(4, 4, T - 8, T - 8);
    g.fillStyle(color); g.fillRect(6, 6, T - 12, T - 12);
    g.fillStyle(0xffffff, 0.3); g.fillRect(8, 8, T - 16, 10);
    g.generateTexture(key, T, T);
}

// ============================================================
//  ESCENA: MENU PRINCIPAL
// ============================================================
class SceneMenu extends Phaser.Scene {
    constructor() { super({ key: 'SceneMenu' }); }

    preload() {
        this.load.image('char0_raw', 'assets/personajes/char0.png');
        this.load.image('char1_raw', 'assets/personajes/char1.png');
        this.load.image('char2_raw', 'assets/personajes/char2.png');
        this.load.image('char3_raw', 'assets/personajes/char3.png');
        this.load.image('map0', 'assets/mapas/map0.png');
        this.load.image('map1', 'assets/mapas/map1.png');
        this.load.image('map2', 'assets/mapas/map2.png');
        this.load.image('map3', 'assets/mapas/map3.png');
        this.load.image('map4', 'assets/mapas/map4.png');
    }

    create() {
        document.getElementById('loading-screen').style.display = 'none';

        generarTexturas(this);

        // Desactivar captura global de teclado para que los inputs HTML funcionen
        this.input.keyboard.disableGlobalCapture();

        // Aplicar chroma key a personajes; si falla, usar textura de respaldo
        for (let i = 0; i < 4; i++) {
            const ok = aplicarChromaKey(this, `char${i}_raw`, `char${i}`);
            if (!ok) {
                const c = CHAR_FALLBACK_COLORS[i];
                generarPersonajeFallback(this, `char${i}`, c.cuerpo, c.accento);
                console.log(`Personaje ${i}: usando sprite de respaldo`);
            }
        }

        // Verificar que los mapas cargaron; si no, generar respaldo
        for (let i = 0; i < 5; i++) {
            if (!texturaValida(this, `map${i}`)) {
                // Generar miniatura de mapa programatica
                const g = this.make.graphics({ add: false });
                const colores = [0x3d8b37, 0x8b7355, 0x2d2d3d, 0x1a3320, 0x6b7355];
                g.fillStyle(colores[i]); g.fillRect(0, 0, 100, 75);
                g.fillStyle(0x555566); g.fillRect(10, 10, 80, 55);
                g.fillStyle(colores[i]); g.fillRect(15, 15, 70, 45);
                g.generateTexture(`map${i}`, 100, 75);
                g.destroy();
                console.log(`Mapa ${i}: usando miniatura de respaldo`);
            }
        }

        const W = this.scale.width, H = this.scale.height;
        const small = W < 600;

        // FONDO
        this.add.rectangle(W / 2, H / 2, W, H, 0x16213e);
        for (let y = 0; y < Math.ceil(H / 48) + 1; y++)
            for (let x = 0; x < Math.ceil(W / 48) + 1; x++)
                this.add.image(x * 48 + 24, y * 48 + 24, 'floor').setAlpha(0.12);

        // TITULO
        const titleY = small ? H * 0.07 : 52;
        this.add.text(W / 2, titleY, 'BOMBERMAN', {
            fontSize: small ? '34px' : '52px', fontFamily: 'Arial Black',
            color: '#e94560', stroke: '#000000', strokeThickness: 7
        }).setOrigin(0.5);
        this.add.text(W / 2, titleY + (small ? 32 : 42), '1 v 1  O N L I N E', {
            fontSize: small ? '12px' : '17px', color: '#ffcc44',
            fontFamily: 'Courier New', letterSpacing: 3
        }).setOrigin(0.5);

        // SELECCION DE PERSONAJE
        const charLabelY = small ? H * 0.20 : 148;
        this.add.text(W / 2, charLabelY, 'Elige tu personaje:', {
            fontSize: small ? '11px' : '13px', color: '#aabbcc'
        }).setOrigin(0.5);

        const charSize = small ? Math.floor(W * 0.16) : 70;
        const charGap = small ? 6 : 8;
        const totalCharW = 4 * charSize + 3 * charGap;
        const charStartX = W / 2 - totalCharW / 2 + charSize / 2;
        const charRowY = charLabelY + 14 + charSize / 2;

        this.charBorders = [];
        for (let i = 0; i < 4; i++) {
            const cx = charStartX + i * (charSize + charGap);

            const bg = this.add.rectangle(cx, charRowY, charSize, charSize, 0x0f3460, 0.85)
                .setStrokeStyle(1, 0x1a5080).setInteractive({ useHandCursor: true });

            this.add.image(cx, charRowY, `char${i}`).setDisplaySize(charSize, charSize);

            this.add.text(cx, charRowY + charSize / 2 + 4, PERSONAJES[i].nombre, {
                fontSize: small ? '8px' : '10px', color: PERSONAJES[i].color, fontFamily: 'Arial Black'
            }).setOrigin(0.5);

            const border = this.add.image(cx, charRowY, 'sel_border')
                .setDisplaySize(charSize, charSize).setAlpha(i === 0 ? 1 : 0);
            this.charBorders.push(border);

            bg.on('pointerdown', () => this.seleccionarPersonaje(i));
        }

        // SELECCION DE MAPA
        const mapLabelY = small ? H * 0.46 : 282;
        this.add.text(W / 2, mapLabelY, 'Selecciona el mapa:', {
            fontSize: small ? '11px' : '13px', color: '#aabbcc'
        }).setOrigin(0.5);

        const mapW = small ? Math.floor((W - 36) / 5) - 4 : 68;
        const mapH = Math.round(mapW * 0.75);
        const mapGap = 4;
        const totalMapW = 5 * mapW + 4 * mapGap;
        const mapStartX = W / 2 - totalMapW / 2 + mapW / 2;
        const mapRowY = mapLabelY + 14 + mapH / 2;

        this.mapBorders = [];
        for (let i = 0; i < 5; i++) {
            const mx = mapStartX + i * (mapW + mapGap);

            this.add.image(mx, mapRowY, `map${i}`).setDisplaySize(mapW, mapH);

            this.add.text(mx, mapRowY + mapH / 2 + 3, MAPAS_NOMBRES[i], {
                fontSize: small ? '7px' : '9px', color: '#aabbcc'
            }).setOrigin(0.5);

            const mbg = this.add.rectangle(mx, mapRowY, mapW, mapH, 0, 0)
                .setStrokeStyle(i === 0 ? 2 : 0, 0xffcc00)
                .setInteractive({ useHandCursor: true });
            this.mapBorders.push(mbg);
            mbg.on('pointerdown', () => this.seleccionarMapa(i));
        }

        // NOMBRE
        const nameY = small ? H * 0.645 : 374;
        this.add.text(W / 2, nameY - 15, 'Tu nombre:', {
            fontSize: small ? '11px' : '13px', color: '#aabbcc'
        }).setOrigin(0.5);
        this.inputNombre = this.crearInput(W / 2 - (small ? 65 : 88), nameY, small ? 130 : 176, 'Bomber');

        // BOTONES
        const btnY = small ? H * 0.735 : 422;
        const btnW = small ? 108 : 148;
        const btnGap = small ? 62 : 82;
        this.crearBoton(W / 2 - btnGap, btnY, btnW, 'CREAR SALA', 0xaa2244, () => this.accionCrear());
        this.crearBoton(W / 2 + btnGap, btnY, btnW, 'UNIRSE', 0x226644, () => this.accionUnirse());

        // Codigo sala generado al crear
        this.textoIdSala = this.add.text(W / 2, btnY + 30, '', {
            fontSize: small ? '26px' : '32px', color: '#ffcc44',
            fontFamily: 'Courier New', stroke: '#000', strokeThickness: 4
        }).setOrigin(0.5);

        // Input codigo sala para unirse
        const joinY = small ? H * 0.825 : 490;
        this.add.text(W / 2, joinY - 14, 'Codigo para unirse:', {
            fontSize: small ? '10px' : '12px', color: '#667788'
        }).setOrigin(0.5);
        this.inputSala = this.crearInput(W / 2 - (small ? 44 : 56), joinY, small ? 88 : 112, 'ABCDE');
        this.inputSala.style.textTransform = 'uppercase';

        // Estado
        const estadoY = small ? H * 0.905 : 545;
        this.textoEstado = this.add.text(W / 2, estadoY, '', {
            fontSize: small ? '11px' : '13px', color: '#ff6644'
        }).setOrigin(0.5);
        this.textoEspera = this.add.text(W / 2, estadoY + 18, '', {
            fontSize: small ? '10px' : '12px', color: '#88aacc'
        }).setOrigin(0.5);

        // Inicializar seleccion
        estadoGlobal.personaje = 0;
        estadoGlobal.selectedMap = 0;
    }

    seleccionarPersonaje(i) {
        estadoGlobal.personaje = i;
        this.charBorders.forEach((b, idx) => b.setAlpha(idx === i ? 1 : 0));
    }

    seleccionarMapa(i) {
        estadoGlobal.selectedMap = i;
        this.mapBorders.forEach((b, idx) => b.setStrokeStyle(idx === i ? 2 : 0, 0xffcc00));
    }

    crearInput(x, y, w, placeholder) {
        const inp = document.createElement('input');
        inp.type = 'text'; inp.placeholder = placeholder;
        const rect = this.game.canvas.getBoundingClientRect();
        const scaleX = rect.width / SCREEN_W;
        const scaleY = rect.height / SCREEN_H;
        inp.style.cssText = `
            position:absolute;
            left:${Math.round(rect.left + window.scrollX + x * scaleX)}px;
            top:${Math.round(rect.top + window.scrollY + y * scaleY)}px;
            width:${Math.round(w * scaleX)}px;
            height:${Math.round(28 * scaleY)}px;
            font-size:${Math.round(14 * Math.min(scaleX, scaleY))}px;
            text-align:center;background:#16213e;color:#e94560;
            border:2px solid #0f3460;border-radius:4px;outline:none;
            font-family:Courier New,monospace;z-index:100;`;
        document.body.appendChild(inp);
        if (!this._inputs) this._inputs = [];
        this._inputs.push(inp);
        return inp;
    }

    crearBoton(x, y, w, texto, color, cb) {
        const btn = this.add.rectangle(x, y, w, 36, color, 0.9)
            .setInteractive({ useHandCursor: true }).setStrokeStyle(2, 0xffffff);
        const lbl = this.add.text(x, y, texto, {
            fontSize: '13px', fontFamily: 'Arial Black', color: '#fff'
        }).setOrigin(0.5);
        btn.on('pointerover', () => { btn.setScale(1.05); lbl.setScale(1.05); });
        btn.on('pointerout', () => { btn.setScale(1); lbl.setScale(1); });
        btn.on('pointerdown', cb);
    }

    limpiarInputs() {
        (this._inputs || []).forEach(i => i.remove());
        this._inputs = [];
    }

    async accionCrear() {
        const nombre = this.inputNombre.value.trim() || 'Jugador1';
        const id = generarIdSala();
        // fullSeed = timestamp * 10 + mapType (0-4)
        const fullSeed = Date.now() * 10 + estadoGlobal.selectedMap;
        estadoGlobal = { ...estadoGlobal, idSala: id, nombreJugador: nombre, numJugador: 1, canal: null };
        this.textoEstado.setText('Creando...').setColor('#88aacc');

        try {
            await crearSala(id, nombre, fullSeed, estadoGlobal.personaje);
            this.textoIdSala.setText(id);
            this.textoEspera.setText('Comparte este codigo!');
            this.textoEstado.setText('');

            escucharSala(id, (datos) => {
                if (datos.estado === 'jugando' && datos.jugador2) {
                    let rivalPersonaje = datos.jugador2.personaje ?? 0;
                    // Si el rival eligio el mismo personaje, asignarle el siguiente
                    if (rivalPersonaje === estadoGlobal.personaje) {
                        rivalPersonaje = (rivalPersonaje + 1) % 4;
                    }
                    estadoGlobal.personajeRival = rivalPersonaje;
                    this.textoEspera.setText('Rival: ' + datos.jugador2.nombre + ' - Iniciando!');
                    this.time.delayedCall(1000, () => {
                        this.limpiarInputs();
                        this.scene.start('SceneGame', {
                            seed: fullSeed,
                            miPersonaje: estadoGlobal.personaje,
                            rivalPersonaje
                        });
                    });
                }
            });
        } catch (e) {
            this.textoEstado.setText('Error: ' + (e.message || e)).setColor('#ff4444');
        }
    }

    async accionUnirse() {
        const nombre = this.inputNombre.value.trim() || 'Jugador2';
        const id = this.inputSala.value.trim().toUpperCase();
        if (id.length < 4) { this.textoEstado.setText('Codigo invalido').setColor('#ff4444'); return; }

        this.textoEstado.setText('Buscando...').setColor('#88aacc');
        try {
            const datos = await leerSala(id);
            if (!datos) { this.textoEstado.setText('Sala no encontrada').setColor('#ff4444'); return; }
            if (datos.jugador2) { this.textoEstado.setText('Sala llena').setColor('#ff4444'); return; }

            const fullSeed = datos.timer_inicio;
            let rivalPersonaje = datos.jugador1?.personaje ?? 0;
            // Si el rival eligio el mismo personaje, auto-cambiar el mio
            if (rivalPersonaje === estadoGlobal.personaje) {
                estadoGlobal.personaje = (estadoGlobal.personaje + 2) % 4;
            }
            estadoGlobal = { ...estadoGlobal, idSala: id, nombreJugador: nombre, numJugador: 2, canal: null };
            estadoGlobal.personajeRival = rivalPersonaje;

            await unirseASala(id, nombre, estadoGlobal.personaje);
            this.textoEstado.setText('Conectado! Iniciando...');
            this.time.delayedCall(800, () => {
                this.limpiarInputs();
                this.scene.start('SceneGame', {
                    seed: fullSeed,
                    miPersonaje: estadoGlobal.personaje,
                    rivalPersonaje
                });
            });
        } catch (e) {
            this.textoEstado.setText('Error: ' + (e.message || e)).setColor('#ff4444');
        }
    }
}

// ============================================================
//  ESCENA: JUEGO PRINCIPAL
// ============================================================
class SceneGame extends Phaser.Scene {
    constructor() { super({ key: 'SceneGame' }); }

    init(data) {
        this.seedInicial = data.seed || null;
        this.miPersonaje = data.miPersonaje ?? 0;
        this.rivalPersonaje = data.rivalPersonaje ?? 0;
    }

    create() {
        const W = this.scale.width, H = this.scale.height;
        this.L = calcLayout(W, H);

        // Variables del juego
        this.mapa = null;
        this.powerupsData = {};
        this.tileSprites = [];
        this.bombs = [];
        this.explosiones = [];
        this.powerupSprites = {};
        this.juegoActivo = false;
        this.syncTimer = 0;
        this.kickedBombs = [];
        this.mapType = 0;

        // Jugador local
        this.local = {
            gridX: 1, gridY: 1,
            pixelX: 0, pixelY: 0,
            moving: false, targetX: 0, targetY: 0,
            dir: 'down', speed: BASE_SPEED,
            maxBombs: 1, bombsOut: 0,
            fireRange: 1, hasKick: false, alive: true
        };

        // Jugador remoto
        this.remoto = {
            gridX: COLS - 2, gridY: ROWS - 2,
            pixelX: 0, pixelY: 0, dir: 'down', alive: true,
            speed: BASE_SPEED, maxBombs: 1, fireRange: 1, hasKick: false, bombsOut: 0
        };

        if (estadoGlobal.numJugador === 2) {
            this.local.gridX = COLS - 2; this.local.gridY = ROWS - 2;
            this.remoto.gridX = 1; this.remoto.gridY = 1;
        }

        this.local.pixelX = this.gx(this.local.gridX);
        this.local.pixelY = this.gy(this.local.gridY);
        this.remoto.pixelX = this.gx(this.remoto.gridX);
        this.remoto.pixelY = this.gy(this.remoto.gridY);

        // Fondo
        this.add.rectangle(W / 2, H / 2, W, H, 0x1a1a2e);

        // UI
        this.construirUI();

        // Teclado — reactivar captura (fue desactivada en menu para los inputs)
        this.input.keyboard.enableGlobalCapture();
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys({
            W: Phaser.Input.Keyboard.KeyCodes.W, A: Phaser.Input.Keyboard.KeyCodes.A,
            S: Phaser.Input.Keyboard.KeyCodes.S, D: Phaser.Input.Keyboard.KeyCodes.D,
            SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE
        });

        // Controles tactiles
        this.touchDir = null;
        this.touchBomb = false;
        if (ES_MOVIL) this.crearControlesTactiles();

        this.iniciarConSeed(this.seedInicial);
        this.conectarCanal();
    }

    gx(col) { return this.L.offX + col * this.L.tile + this.L.tile / 2; }
    gy(row) { return this.L.offY + row * this.L.tile + this.L.tile / 2; }

    // ========== UI ==========
    construirUI() {
        const { W, H, offX, offY, tile } = this.L;

        if (!ES_MOVIL) {
            // Panel izquierdo desktop
            this.add.rectangle(140, H / 2, 260, H - 20, 0x0f3460, 0.5).setStrokeStyle(1, 0x1a3a5c);
            this.add.text(140, 28, 'BOMBERMAN 1v1', {
                fontSize: '17px', fontFamily: 'Arial Black', color: '#e94560'
            }).setOrigin(0.5);

            const p1Char = estadoGlobal.numJugador === 1 ? this.miPersonaje : this.rivalPersonaje;
            const p2Char = estadoGlobal.numJugador === 1 ? this.rivalPersonaje : this.miPersonaje;
            const p1Label = estadoGlobal.numJugador === 1 ? 'TU' : 'RIVAL';
            const p2Label = estadoGlobal.numJugador === 1 ? 'RIVAL' : 'TU';

            this.add.image(58, 82, `char${p1Char}`).setDisplaySize(46, 46);
            this.add.text(90, 73, p1Label, { fontSize: '13px', color: '#4488ff', fontFamily: 'Arial Black' });
            this.textoStatsP1 = this.add.text(36, 108, '', { fontSize: '11px', color: '#aabbcc', lineSpacing: 3 });

            this.add.image(58, 198, `char${p2Char}`).setDisplaySize(46, 46);
            this.add.text(90, 189, p2Label, { fontSize: '13px', color: '#e94560', fontFamily: 'Arial Black' });
            this.textoStatsP2 = this.add.text(36, 224, '', { fontSize: '11px', color: '#aabbcc', lineSpacing: 3 });

            this.add.text(140, 338, 'CONTROLES', { fontSize: '12px', color: '#667788', fontFamily: 'Arial Black' }).setOrigin(0.5);
            this.add.text(26, 356, 'WASD / Flechas = Mover\nESPACIO = Bomba\n\nPower-ups:\nB=+Bomba  F=+Fuego\nS=+Vel    K=Patear',
                { fontSize: '11px', color: '#556677', lineSpacing: 5 });

            this.textoEstadoJuego = this.add.text(140, 525, 'Conectando...', {
                fontSize: '13px', color: '#ffcc44'
            }).setOrigin(0.5);
        } else {
            // Mini HUD mobile — barra superior
            this.textoStatsP1 = this.add.text(0, 0, '', { fontSize: '1px' }).setVisible(false);
            this.textoStatsP2 = this.add.text(0, 0, '', { fontSize: '1px' }).setVisible(false);

            this.add.rectangle(W / 2, 10, W, 20, 0x000000, 0.7).setDepth(150);

            this.mobileHudLocal = this.add.text(6, 2, '', {
                fontSize: '10px', color: PERSONAJES[this.miPersonaje].color, fontFamily: 'Arial Black'
            }).setDepth(151);
            this.mobileHudRemoto = this.add.text(W - 6, 2, '', {
                fontSize: '10px', color: PERSONAJES[this.rivalPersonaje].color, fontFamily: 'Arial Black'
            }).setOrigin(1, 0).setDepth(151);

            this.textoEstadoJuego = this.add.text(W / 2, 2, 'Conectando...', {
                fontSize: '10px', color: '#ffcc44'
            }).setOrigin(0.5, 0).setDepth(151);
        }

        // Cuenta regresiva centrada sobre el mapa
        const mapCX = this.L.offX + COLS * this.L.tile / 2;
        const mapCY = this.L.offY + ROWS * this.L.tile / 2;
        this.textoCuenta = this.add.text(mapCX, mapCY, '', {
            fontSize: ES_MOVIL ? '64px' : '96px', fontFamily: 'Arial Black',
            color: '#ffffff', stroke: '#000000', strokeThickness: 10
        }).setOrigin(0.5).setDepth(100);
    }

    // ========== CONTROLES TACTILES — JOYSTICK VIRTUAL ==========
    crearControlesTactiles() {
        const { W, H, offX, offY, tile } = this.L;
        const depth = 200;
        const gridRight = offX + COLS * tile;
        const gridBottom = offY + ROWS * tile;

        // Calcular zona del joystick y botón bomba
        let joyZoneX, joyZoneY, joyZoneW, joyZoneH, bombX, bombY, bombR;

        if (ES_PORTRAIT) {
            const areaH = H - gridBottom;
            joyZoneX = 0;
            joyZoneY = gridBottom;
            joyZoneW = W * 0.6;
            joyZoneH = areaH;
            bombX = W * 0.8;
            bombY = gridBottom + areaH / 2;
            bombR = Math.max(30, Math.min(50, areaH / 3.5));
        } else {
            const areaW = W - gridRight;
            joyZoneX = gridRight;
            joyZoneY = 0;
            joyZoneW = areaW * 0.6;
            joyZoneH = H;
            bombX = gridRight + areaW * 0.78;
            bombY = H / 2;
            bombR = Math.max(30, Math.min(50, areaW / 4));
        }

        // Radio del joystick
        const joyRadius = Math.max(36, Math.min(60, Math.min(joyZoneW, joyZoneH) / 3.5));
        const thumbRadius = Math.round(joyRadius * 0.45);
        const deadZone = joyRadius * 0.2;  // zona muerta central

        // Zona interactiva invisible para capturar toques del joystick
        const joyZone = this.add.rectangle(
            joyZoneX + joyZoneW / 2, joyZoneY + joyZoneH / 2,
            joyZoneW, joyZoneH, 0x000000, 0.001
        ).setDepth(depth - 2).setInteractive();

        // Base del joystick (circulo exterior)
        this.joyBase = this.add.circle(0, 0, joyRadius, 0x000000, 0.35)
            .setDepth(depth - 1).setStrokeStyle(2, 0xffffff, 0.2).setVisible(false);

        // Thumb del joystick (circulo interior que sigue el dedo)
        this.joyThumb = this.add.circle(0, 0, thumbRadius, 0x4488ff, 0.7)
            .setDepth(depth).setStrokeStyle(2, 0xffffff, 0.5).setVisible(false);

        // Indicadores de dirección en la base (sutiles)
        this.joyArrows = [];
        const arrowDirs = [
            { angle: 0, icon: '▶' }, { angle: Math.PI, icon: '◀' },
            { angle: -Math.PI / 2, icon: '▲' }, { angle: Math.PI / 2, icon: '▼' }
        ];
        arrowDirs.forEach(({ angle, icon }) => {
            const arrow = this.add.text(0, 0, icon, {
                fontSize: Math.round(joyRadius * 0.3) + 'px', color: '#ffffff'
            }).setOrigin(0.5).setDepth(depth).setAlpha(0.3).setVisible(false);
            this.joyArrows.push({ sprite: arrow, angle });
        });

        // Estado del joystick
        this.joyActive = false;
        this.joyOriginX = 0;
        this.joyOriginY = 0;

        // Activar joystick al tocar la zona
        joyZone.on('pointerdown', (pointer) => {
            this.joyActive = true;
            this.joyOriginX = pointer.x;
            this.joyOriginY = pointer.y;

            this.joyBase.setPosition(pointer.x, pointer.y).setVisible(true);
            this.joyThumb.setPosition(pointer.x, pointer.y).setVisible(true);

            // Posicionar flechas alrededor de la base
            const arrowR = joyRadius * 0.72;
            this.joyArrows.forEach(({ sprite, angle }) => {
                sprite.setPosition(
                    pointer.x + Math.cos(angle) * arrowR,
                    pointer.y + Math.sin(angle) * arrowR
                ).setVisible(true).setAlpha(0.3);
            });
        });

        // Mover el thumb siguiendo el dedo
        this.input.on('pointermove', (pointer) => {
            if (!this.joyActive) return;

            const dx = pointer.x - this.joyOriginX;
            const dy = pointer.y - this.joyOriginY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Limitar el thumb al radio del joystick
            let thumbX, thumbY;
            if (dist <= joyRadius) {
                thumbX = pointer.x;
                thumbY = pointer.y;
            } else {
                thumbX = this.joyOriginX + (dx / dist) * joyRadius;
                thumbY = this.joyOriginY + (dy / dist) * joyRadius;
            }
            this.joyThumb.setPosition(thumbX, thumbY);

            // Determinar dirección (4 direcciones) si supera zona muerta
            if (dist > deadZone) {
                const angle = Math.atan2(dy, dx);
                // Dividir en 4 cuadrantes
                if (angle > -Math.PI / 4 && angle <= Math.PI / 4) {
                    this.touchDir = 'right';
                } else if (angle > Math.PI / 4 && angle <= 3 * Math.PI / 4) {
                    this.touchDir = 'down';
                } else if (angle > -3 * Math.PI / 4 && angle <= -Math.PI / 4) {
                    this.touchDir = 'up';
                } else {
                    this.touchDir = 'left';
                }

                // Resaltar flecha activa
                const dirMap = { 'right': 0, 'left': 1, 'up': 2, 'down': 3 };
                this.joyArrows.forEach(({ sprite }, i) => {
                    sprite.setAlpha(i === dirMap[this.touchDir] ? 0.9 : 0.25);
                });

                // Color del thumb según dirección activa
                this.joyThumb.setFillStyle(0x66aaff, 0.85);
            } else {
                this.touchDir = null;
                this.joyArrows.forEach(({ sprite }) => sprite.setAlpha(0.3));
                this.joyThumb.setFillStyle(0x4488ff, 0.7);
            }
        });

        // Soltar el joystick
        this.input.on('pointerup', (pointer) => {
            if (!this.joyActive) return;
            this.joyActive = false;
            this.touchDir = null;
            this.joyBase.setVisible(false);
            this.joyThumb.setVisible(false);
            this.joyArrows.forEach(({ sprite }) => sprite.setVisible(false));
        });

        // Botón bomba (se mantiene igual, lado derecho)
        const btnBomb = this.add.circle(bombX, bombY, bombR, 0xe94560, 0.55)
            .setDepth(depth).setInteractive().setStrokeStyle(2, 0xffffff, 0.4);
        this.add.text(bombX, bombY - Math.round(bombR * 0.15), '💣', {
            fontSize: Math.round(bombR * 0.65) + 'px'
        }).setOrigin(0.5).setDepth(depth + 1);
        this.add.text(bombX, bombY + Math.round(bombR * 0.55), 'BOMBA', {
            fontSize: Math.max(8, Math.round(bombR * 0.25)) + 'px',
            fontFamily: 'Arial Black', color: '#ffffff'
        }).setOrigin(0.5).setDepth(depth + 1).setAlpha(0.9);

        btnBomb.on('pointerdown', () => { this.touchBomb = true; btnBomb.setFillStyle(0xff6680, 0.9); });
        btnBomb.on('pointerup', () => { btnBomb.setFillStyle(0xe94560, 0.6); });
        btnBomb.on('pointerout', () => { btnBomb.setFillStyle(0xe94560, 0.6); });
    }

    // ========== CANAL MULTIPLAYER ==========
    conectarCanal() {
        const canal = crearCanalJuego(estadoGlobal.idSala);

        canal.on('broadcast', { event: 'move' }, ({ payload }) => {
            this.remoto.gridX = payload.gx; this.remoto.gridY = payload.gy;
            this.remoto.pixelX = payload.px; this.remoto.pixelY = payload.py;
            this.remoto.dir = payload.dir;
            if (this.remotoSprite) this.remotoSprite.setPosition(payload.px, payload.py);
        });

        canal.on('broadcast', { event: 'bomb' }, ({ payload }) => {
            this.crearBomba(payload.x, payload.y, payload.range, false);
        });

        canal.on('broadcast', { event: 'muerte' }, () => {
            this.remoto.alive = false;
            if (this.remotoSprite)
                this.remotoSprite.setTexture('tumba').setDisplaySize(this.L.tile, this.L.tile).setOrigin(0.5);
            this.finalizarPartida(true);
        });

        canal.on('broadcast', { event: 'kick' }, ({ payload }) => {
            const bomba = this.bombs.find(b => b.gridX === payload.ox && b.gridY === payload.oy);
            if (bomba) this.iniciarKick(bomba, payload.dir);
        });

        canal.subscribe((status) => {
            if (status === 'SUBSCRIBED') this.textoEstadoJuego.setText('Conectado!');
        });
    }

    // ========== INICIAR PARTIDA ==========
    iniciarConSeed(seed) {
        if (this.mapa) return;

        const resultado = generarMapa(seed);
        this.mapa = resultado.mapa;
        this.powerupsData = resultado.powerups;
        this.mapType = resultado.mapType;

        this.dibujarMapa();
        this.crearJugadores();

        this.textoEstadoJuego.setText('Preparate!');
        let cuenta = 3;
        this.textoCuenta.setText(cuenta.toString());

        const timer = this.time.addEvent({
            delay: 800, callback: () => {
                cuenta--;
                if (cuenta > 0) this.textoCuenta.setText(cuenta.toString());
                else if (cuenta === 0) this.textoCuenta.setText('GO!');
                else {
                    this.textoCuenta.setText('');
                    this.juegoActivo = true;
                    this.textoEstadoJuego.setText('En juego!');
                    timer.remove();
                }
            }, loop: true
        });
    }

    // ========== DIBUJAR MAPA ==========
    dibujarMapa() {
        const { offX, offY, tile } = this.L;
        const gridW = COLS * tile, gridH = ROWS * tile;
        const cx = offX + gridW / 2, cy = offY + gridH / 2;

        // Fondo imagen del mapa (visible) con fallback
        const mapKey = `map${this.mapType}`;
        if (texturaValida(this, mapKey)) {
            this.add.image(cx, cy, mapKey)
                .setDisplaySize(gridW, gridH).setAlpha(0.55).setDepth(0);
        } else {
            // Fallback: rectángulo de color según tipo de mapa
            const mapColors = [0x2d5a1e, 0x3a3a5c, 0x5c2a0e, 0x1a3a5a, 0x4a1a3a];
            this.add.rectangle(cx, cy, gridW, gridH, mapColors[this.mapType] || 0x2d5a1e)
                .setAlpha(0.55).setDepth(0);
        }

        // Tiles
        for (let y = 0; y < ROWS; y++) {
            this.tileSprites[y] = [];
            for (let x = 0; x < COLS; x++) {
                const px = this.gx(x), py = this.gy(y);

                if (this.mapa[y][x] !== 1)
                    this.add.image(px, py, 'floor').setDisplaySize(tile, tile).setDepth(1);

                if (this.mapa[y][x] === 1) {
                    this.tileSprites[y][x] = this.add.image(px, py, 'wall').setDisplaySize(tile, tile).setDepth(2);
                } else if (this.mapa[y][x] === 2) {
                    this.tileSprites[y][x] = this.add.image(px, py, 'block').setDisplaySize(tile, tile).setDepth(2);
                } else {
                    this.tileSprites[y][x] = null;
                }
            }
        }

        // Borde del area de juego
        this.add.rectangle(cx, cy, gridW + 4, gridH + 4)
            .setStrokeStyle(2, 0xe94560).setFillStyle(0, 0).setDepth(3);
    }

    // ========== JUGADORES ==========
    crearJugadores() {
        const tile = this.L.tile;
        const charSize = Math.round(tile * 1.4);

        this.localSprite = this.add.image(this.local.pixelX, this.local.pixelY, `char${this.miPersonaje}`)
            .setDisplaySize(charSize, charSize).setOrigin(0.5, 0.5).setDepth(10);

        this.remotoSprite = this.add.image(this.remoto.pixelX, this.remoto.pixelY, `char${this.rivalPersonaje}`)
            .setDisplaySize(charSize, charSize).setOrigin(0.5, 0.5).setDepth(10);

        // Guardar el scale base que corresponde al displaySize
        // (setDisplaySize calcula internamente scaleX/Y, lo guardamos para no perderlo)
        this.localBaseScaleX = this.localSprite.scaleX;
        this.localBaseScaleY = this.localSprite.scaleY;
        this.remotoBaseScaleX = this.remotoSprite.scaleX;
        this.remotoBaseScaleY = this.remotoSprite.scaleY;

        // Sombra bajo cada jugador para hacer mas visibles
        this.localShadow = this.add.ellipse(this.local.pixelX, this.local.pixelY + tile * 0.35,
            tile * 0.6, tile * 0.2, 0x000000, 0.3).setDepth(9);
        this.remotoShadow = this.add.ellipse(this.remoto.pixelX, this.remoto.pixelY + tile * 0.35,
            tile * 0.6, tile * 0.2, 0x000000, 0.3).setDepth(9);

        // Timer de animacion de bobbing
        this.walkAnimTimer = 0;
    }

    // ========== UPDATE ==========
    update(time, delta) {
        if (!this.juegoActivo || !this.local.alive) return;

        this.manejarMovimiento(delta);
        this.manejarBombas(delta);
        this.actualizarBombasKicked(delta);
        this.actualizarStats();

        this.syncTimer += delta;
        if (this.syncTimer >= SYNC_INTERVAL) {
            this.syncTimer = 0;
            broadcast('move', {
                gx: this.local.gridX, gy: this.local.gridY,
                px: this.local.pixelX, py: this.local.pixelY,
                dir: this.local.dir
            });
        }

        if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) || this.touchBomb) {
            this.ponerBomba();
            this.touchBomb = false;
        }

        // Animacion de caminar (bobbing + squash)
        this.animarMovimiento(delta);
    }

    animarMovimiento(delta) {
        const tile = this.L.tile;
        const bsxL = this.localBaseScaleX || 1;
        const bsyL = this.localBaseScaleY || 1;
        const bsxR = this.remotoBaseScaleX || 1;
        const bsyR = this.remotoBaseScaleY || 1;

        if (this.localSprite && this.local.alive) {
            if (this.local.moving) {
                this.walkAnimTimer += delta * 0.012;
                const bob = Math.sin(this.walkAnimTimer * 6) * tile * 0.06;
                const squash = 1 + Math.sin(this.walkAnimTimer * 12) * 0.06;
                this.localSprite.setY(this.local.pixelY + bob);
                this.localSprite.setX(this.local.pixelX);
                this.localSprite.setScale(bsxL * squash, bsyL * (2 - squash));
                // Flip horizontal segun direccion
                this.localSprite.setFlipX(this.local.dir === 'left');
            } else {
                this.walkAnimTimer = 0;
                this.localSprite.setPosition(this.local.pixelX, this.local.pixelY);
                this.localSprite.setScale(bsxL, bsyL);
            }
            // Actualizar sombra
            if (this.localShadow) {
                this.localShadow.setPosition(this.local.pixelX, this.local.pixelY + tile * 0.35);
            }
        }

        // Animacion suave del remoto (interpolacion)
        if (this.remotoSprite && this.remoto.alive) {
            const rx = this.remotoSprite.x, ry = this.remotoSprite.y;
            const tx = this.remoto.pixelX, ty = this.remoto.pixelY;
            const isMoving = Math.abs(rx - tx) > 1 || Math.abs(ry - ty) > 1;
            if (isMoving) {
                this.remotoSprite.setFlipX(this.remoto.dir === 'left');
                const bob = Math.sin(Date.now() * 0.008) * tile * 0.05;
                this.remotoSprite.setY(ty + bob);
                const sq = 1 + Math.sin(Date.now() * 0.016) * 0.05;
                this.remotoSprite.setScale(bsxR * sq, bsyR * (2 - sq));
            } else {
                this.remotoSprite.setPosition(tx, ty);
                this.remotoSprite.setScale(bsxR, bsyR);
            }
            if (this.remotoShadow) {
                this.remotoShadow.setPosition(this.remoto.pixelX, this.remoto.pixelY + tile * 0.35);
            }
        }
    }

    // ========== MOVIMIENTO ==========
    manejarMovimiento(delta) {
        if (this.local.moving) {
            const dx = this.local.targetX - this.local.pixelX;
            const dy = this.local.targetY - this.local.pixelY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const step = this.local.speed * delta / 1000;
            if (dist <= step + 1) {
                this.local.pixelX = this.local.targetX;
                this.local.pixelY = this.local.targetY;
                this.local.moving = false;
                this.checkPowerup(this.local.gridX, this.local.gridY);
                this.checkExplosion(this.local.gridX, this.local.gridY);
            } else {
                this.local.pixelX += (dx / dist) * step;
                this.local.pixelY += (dy / dist) * step;
            }
        }

        if (!this.local.moving) {
            let dx = 0, dy = 0, dir = null;
            if (this.cursors.left.isDown || this.keys.A.isDown) { dx = -1; dir = 'left'; }
            else if (this.cursors.right.isDown || this.keys.D.isDown) { dx = 1; dir = 'right'; }
            else if (this.cursors.up.isDown || this.keys.W.isDown) { dy = -1; dir = 'up'; }
            else if (this.cursors.down.isDown || this.keys.S.isDown) { dy = 1; dir = 'down'; }
            else if (this.touchDir === 'left') { dx = -1; dir = 'left'; }
            else if (this.touchDir === 'right') { dx = 1; dir = 'right'; }
            else if (this.touchDir === 'up') { dy = -1; dir = 'up'; }
            else if (this.touchDir === 'down') { dy = 1; dir = 'down'; }

            if (dir) {
                this.local.dir = dir;
                const nx = this.local.gridX + dx, ny = this.local.gridY + dy;
                if (this.puedeMover(nx, ny)) {
                    this.local.gridX = nx; this.local.gridY = ny;
                    this.local.targetX = this.gx(nx);
                    this.local.targetY = this.gy(ny);
                    this.local.moving = true;
                } else if (this.local.hasKick) {
                    const bomba = this.bombs.find(b => b.gridX === nx && b.gridY === ny && !b.kicking);
                    if (bomba) { this.iniciarKick(bomba, dir); broadcast('kick', { ox: nx, oy: ny, dir }); }
                }
            }
        }

        // La posicion del sprite se actualiza en animarMovimiento()
    }

    puedeMover(x, y) {
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
        if (this.mapa[y][x] === 1 || this.mapa[y][x] === 2) return false;
        if (this.bombs.some(b => b.gridX === x && b.gridY === y)) return false;
        return true;
    }

    // ========== BOMBAS ==========
    ponerBomba() {
        if (this.local.bombsOut >= this.local.maxBombs) return;
        const gx = this.local.gridX, gy = this.local.gridY;
        if (this.bombs.some(b => b.gridX === gx && b.gridY === gy)) return;
        this.crearBomba(gx, gy, this.local.fireRange, true);
        broadcast('bomb', { x: gx, y: gy, range: this.local.fireRange });
    }

    crearBomba(gx, gy, range, esLocal) {
        const tile = this.L.tile;
        const sprite = this.add.image(this.gx(gx), this.gy(gy), 'bomb')
            .setDisplaySize(tile, tile).setDepth(5);
        this.tweens.add({ targets: sprite, scaleX: 1.15, scaleY: 1.15, duration: 300, yoyo: true, repeat: -1 });
        const bomba = { gridX: gx, gridY: gy, timer: BOMB_TIMER, range, sprite, esLocal, kicking: false };
        this.bombs.push(bomba);
        if (esLocal) this.local.bombsOut++;
    }

    manejarBombas(delta) {
        const explotar = [];
        this.bombs.forEach(b => { if (!b.kicking) { b.timer -= delta; if (b.timer <= 0) explotar.push(b); } });
        explotar.forEach(b => this.explotarBomba(b));
    }

    explotarBomba(bomba) {
        bomba.sprite.destroy();
        this.bombs = this.bombs.filter(b => b !== bomba);
        if (bomba.esLocal) this.local.bombsOut = Math.max(0, this.local.bombsOut - 1);

        const { gridX, gridY, range } = bomba;
        const afectados = [{ x: gridX, y: gridY }];

        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
            for (let i = 1; i <= range; i++) {
                const nx = gridX + dx * i, ny = gridY + dy * i;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) break;
                if (this.mapa[ny][nx] === 1) break;
                afectados.push({ x: nx, y: ny });
                if (this.mapa[ny][nx] === 2) { this.destruirBloque(nx, ny); break; }
            }
        });

        const tile = this.L.tile;
        const expSprites = afectados.map(({ x, y }) => {
            const isCenter = x === gridX && y === gridY;
            const key = isCenter ? 'exp_center' : (x !== gridX ? 'exp_h' : 'exp_v');
            return this.add.image(this.gx(x), this.gy(y), key).setDisplaySize(tile, tile).setDepth(8).setAlpha(0.9);
        });

        const exp = { tiles: afectados, sprites: expSprites };
        this.explosiones.push(exp);

        // Cadena de bombas
        this.bombs.forEach(b => { if (afectados.some(t => t.x === b.gridX && t.y === b.gridY)) b.timer = 0; });

        // Muerte local
        if (this.local.alive && afectados.some(t => t.x === this.local.gridX && t.y === this.local.gridY))
            this.morir();

        // Muerte remoto
        if (this.remoto.alive && afectados.some(t => t.x === this.remoto.gridX && t.y === this.remoto.gridY)) {
            this.remoto.alive = false;
            if (this.remotoSprite)
                this.remotoSprite.setTexture('tumba').setDisplaySize(tile, tile).setOrigin(0.5);
            this.finalizarPartida(true);
        }

        this.time.delayedCall(EXPLOSION_DURATION, () => {
            expSprites.forEach(s => s.destroy());
            this.explosiones = this.explosiones.filter(e => e !== exp);
        });

        this.cameras.main.shake(80, 0.006);
    }

    destruirBloque(x, y) {
        this.mapa[y][x] = 0;
        if (this.tileSprites[y][x]) { this.tileSprites[y][x].destroy(); this.tileSprites[y][x] = null; }

        const key = x + ',' + y;
        if (this.powerupsData[key]) {
            const tipo = this.powerupsData[key];
            const tile = this.L.tile;
            const px = this.gx(x), py = this.gy(y);
            const sprite = this.add.image(px, py, 'pu_' + tipo).setDisplaySize(tile, tile).setDepth(3);
            const letras = { bomb: 'B', fire: 'F', speed: 'S', kick: 'K' };
            const txt = this.add.text(px, py, letras[tipo], {
                fontSize: Math.max(10, Math.round(tile * 0.42)) + 'px',
                fontFamily: 'Arial Black', color: '#ffffff', stroke: '#000', strokeThickness: 3
            }).setOrigin(0.5).setDepth(4);

            this.powerupSprites[key] = { sprite, txt, tipo };
            sprite.setScale(0); txt.setScale(0);
            this.tweens.add({ targets: [sprite, txt], scale: 1, duration: 300, ease: 'Back.easeOut' });
        }
    }

    // ========== POWER-UPS ==========
    checkPowerup(gx, gy) {
        const key = gx + ',' + gy;
        const pu = this.powerupSprites[key];
        if (!pu) return;

        switch (pu.tipo) {
            case 'bomb': this.local.maxBombs++; break;
            case 'fire': this.local.fireRange++; break;
            case 'speed': this.local.speed += SPEED_BOOST; break;
            case 'kick': this.local.hasKick = true; break;
        }

        pu.sprite.destroy(); pu.txt.destroy();
        delete this.powerupSprites[key]; delete this.powerupsData[key];

        const efecto = this.add.text(this.gx(gx), this.gy(gy) - 20, '+' + pu.tipo.toUpperCase(), {
            fontSize: '13px', fontFamily: 'Arial Black', color: '#ffcc44', stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: efecto, y: efecto.y - 40, alpha: 0, duration: 800, onComplete: () => efecto.destroy() });
    }

    checkExplosion(gx, gy) {
        if (this.explosiones.some(e => e.tiles.some(t => t.x === gx && t.y === gy))) this.morir();
    }

    // ========== KICK ==========
    iniciarKick(bomba, dir) {
        bomba.kicking = true;
        const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
        bomba.kickDx = dirs[dir][0]; bomba.kickDy = dirs[dir][1]; bomba.kickProgress = 0;
        this.kickedBombs.push(bomba);
    }

    actualizarBombasKicked(delta) {
        const parar = [];
        this.kickedBombs.forEach(b => {
            b.timer -= delta;
            b.kickProgress += 6 * delta / 1000;
            if (b.kickProgress >= 1) {
                b.kickProgress = 0;
                const nx = b.gridX + b.kickDx, ny = b.gridY + b.kickDy;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS || this.mapa[ny][nx] !== 0 ||
                    this.bombs.some(ob => ob !== b && ob.gridX === nx && ob.gridY === ny)) {
                    b.kicking = false; parar.push(b);
                } else { b.gridX = nx; b.gridY = ny; }
            }
            b.sprite.setPosition(
                this.gx(b.gridX) + b.kickDx * b.kickProgress * this.L.tile,
                this.gy(b.gridY) + b.kickDy * b.kickProgress * this.L.tile
            );
            if (b.timer <= 0) { b.kicking = false; parar.push(b); this.explotarBomba(b); }
        });
        this.kickedBombs = this.kickedBombs.filter(b => !parar.includes(b));
    }

    // ========== MUERTE ==========
    morir() {
        if (!this.local.alive) return;
        this.local.alive = false;
        this.juegoActivo = false;
        if (this.localSprite)
            this.localSprite.setTexture('tumba').setDisplaySize(this.L.tile, this.L.tile).setOrigin(0.5);
        broadcast('muerte', { jugador: estadoGlobal.numJugador });
        this.finalizarPartida(false);
    }

    finalizarPartida(gane) {
        this.juegoActivo = false;
        this.time.delayedCall(1500, () => {
            this.scene.start('SceneResult', {
                gane,
                miPersonaje: this.miPersonaje,
                rivalPersonaje: this.rivalPersonaje
            });
        });
    }

    // ========== STATS ==========
    actualizarStats() {
        const fmt = (s) =>
            `B:${s.maxBombs} F:${s.fireRange} V:${Math.round(s.speed / BASE_SPEED * 100)}%${s.hasKick ? ' K' : ''}`;

        if (ES_MOVIL) {
            if (this.mobileHudLocal) this.mobileHudLocal.setText('▶ ' + fmt(this.local));
            if (this.mobileHudRemoto) this.mobileHudRemoto.setText(fmt(this.remoto) + ' ◀');
        } else {
            const fmtLong = (s) =>
                `Bombas: ${s.maxBombs} | Fuego: ${s.fireRange}\nVelocidad: ${Math.round(s.speed / BASE_SPEED * 100)}%\nPatear: ${s.hasKick ? 'SI' : 'NO'}`;
            if (estadoGlobal.numJugador === 1) {
                this.textoStatsP1.setText(fmtLong(this.local));
                this.textoStatsP2.setText(fmtLong(this.remoto));
            } else {
                this.textoStatsP1.setText(fmtLong(this.remoto));
                this.textoStatsP2.setText(fmtLong(this.local));
            }
        }
    }
}

// ============================================================
//  ESCENA: RESULTADO
// ============================================================
class SceneResult extends Phaser.Scene {
    constructor() { super({ key: 'SceneResult' }); }

    init(data) {
        this.gane = data.gane;
        this.miPersonaje = data.miPersonaje ?? 0;
        this.rivalPersonaje = data.rivalPersonaje ?? 0;
    }

    create() {
        const W = this.scale.width, H = this.scale.height;

        for (let y = 0; y < Math.ceil(H / 48) + 1; y++)
            for (let x = 0; x < Math.ceil(W / 48) + 1; x++)
                this.add.image(x * 48 + 24, y * 48 + 24, 'floor').setAlpha(0.12);

        this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.78);

        const texto = this.gane ? '¡VICTORIA!' : 'DERROTA...';
        const color = this.gane ? '#44ff88' : '#e94560';
        const charKey = this.gane ? `char${this.miPersonaje}` : 'tumba';
        const charSize = Math.min(130, W * 0.22);

        const titulo = this.add.text(W / 2, H * 0.24, texto, {
            fontSize: Math.min(80, Math.round(W * 0.12)) + 'px', fontFamily: 'Arial Black',
            color, stroke: '#000000', strokeThickness: 10
        }).setOrigin(0.5).setScale(0);
        this.tweens.add({ targets: titulo, scale: 1, duration: 600, ease: 'Back.easeOut' });

        const icono = this.add.image(W / 2, H * 0.5, charKey)
            .setDisplaySize(charSize, charSize).setAlpha(0);
        this.tweens.add({ targets: icono, alpha: 1, duration: 800, delay: 400 });

        const btnW = Math.min(260, W * 0.55), btnY = H * 0.73;
        const btn = this.add.rectangle(W / 2, btnY, btnW, 48, 0xaa2244, 0.9)
            .setStrokeStyle(2, 0xffffff).setInteractive({ useHandCursor: true });
        const btnLbl = this.add.text(W / 2, btnY, 'JUGAR DE NUEVO', {
            fontSize: '17px', fontFamily: 'Arial Black', color: '#fff'
        }).setOrigin(0.5);

        btn.on('pointerover', () => { btn.setScale(1.05); btnLbl.setScale(1.05); });
        btn.on('pointerout', () => { btn.setScale(1); btnLbl.setScale(1); });
        btn.on('pointerdown', () => {
            if (estadoGlobal.canal) { sbClient.removeChannel(estadoGlobal.canal); estadoGlobal.canal = null; }
            estadoGlobal.idSala = null; estadoGlobal.numJugador = null;
            this.scene.start('SceneMenu');
        });

        this.add.text(W / 2, H * 0.87, 'Bomberman 1v1 Online • v2.0', {
            fontSize: '11px', color: '#445566'
        }).setOrigin(0.5);
    }
}

// ============================================================
//  CONFIGURACION PHASER
// ============================================================
const config = {
    type: Phaser.AUTO,
    width: SCREEN_W,
    height: SCREEN_H,
    parent: 'game-container',
    backgroundColor: '#1a1a2e',
    pixelArt: true,
    scene: [SceneMenu, SceneGame, SceneResult],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: SCREEN_W,
        height: SCREEN_H
    }
};

const game = new Phaser.Game(config);
