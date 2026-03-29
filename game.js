// ============================================================
//  BOMBERMAN 1v1 ONLINE
//  Phaser 3 + Supabase Realtime Broadcast
//  Pixel Art clasico generado por codigo (sin assets externos)
// ============================================================

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://lcnkqybqowiycppialvl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjbmtxeWJxb3dpeWNwcGlhbHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjM5MTQsImV4cCI6MjA5MDM5OTkxNH0.VNwwWHzny7y7b6IdYqeoMyRW3dNXDUVaWHXHMxiHaPo';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
//  CONSTANTES DEL JUEGO
// ============================================================
const TILE = 48;          // Tamano de cada casilla en pixeles
const COLS = 15;          // Columnas del mapa
const ROWS = 13;          // Filas del mapa
const OFFSET_X = 280;     // Margen izquierdo del area de juego
const OFFSET_Y = 48;      // Margen superior
const BOMB_TIMER = 2500;  // Tiempo antes de explotar (ms)
const EXPLOSION_DURATION = 500; // Duracion de la explosion visible (ms)
const BASE_SPEED = 150;   // Velocidad base en pixeles/segundo
const SPEED_BOOST = 30;   // Aumento por cada power-up de velocidad
const SYNC_INTERVAL = 50; // Enviar posicion cada 50ms

// Detectar si es movil
const ES_MOVIL = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (window.innerWidth < 800 && 'ontouchstart' in window);

// Offsets dinamicos segun dispositivo
const OFFSET_X_DESKTOP = 280;
const OFFSET_X_MOBILE = 16;
const OFFSET_Y_MOBILE = 16;
const GAME_OFFSET_X = ES_MOVIL ? OFFSET_X_MOBILE : OFFSET_X_DESKTOP;
const GAME_OFFSET_Y = ES_MOVIL ? OFFSET_Y_MOBILE : OFFSET_Y;

// Estado global de la partida
let estadoGlobal = {
    idSala: null,
    nombreJugador: '',
    numJugador: null,
    canal: null
};

// ============================================================
//  GENERADOR DE RANDOM CON SEMILLA
//  (Para que ambos jugadores generen el mismo mapa)
// ============================================================
function seededRandom(seed) {
    let s = Math.abs(seed) || 1;
    return function () {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

// ============================================================
//  GENERADOR DE MAPA
// ============================================================
function generarMapa(seed) {
    const rand = seededRandom(seed);
    const mapa = [];
    const powerups = {};

    for (let y = 0; y < ROWS; y++) {
        mapa[y] = [];
        for (let x = 0; x < COLS; x++) {
            // Bordes = muro
            if (y === 0 || y === ROWS - 1 || x === 0 || x === COLS - 1) {
                mapa[y][x] = 1;
            }
            // Pilares en patron de tablero = muro
            else if (x % 2 === 0 && y % 2 === 0) {
                mapa[y][x] = 1;
            }
            else {
                mapa[y][x] = 0;
            }
        }
    }

    // Zonas libres alrededor de los spawns de cada jugador
    const zonasLibres = [
        // P1 arriba-izquierda
        [1, 1], [2, 1], [1, 2],
        // P2 abajo-derecha
        [COLS - 2, ROWS - 2], [COLS - 3, ROWS - 2], [COLS - 2, ROWS - 3]
    ];

    // Colocar bloques destructibles aleatoriamente (~65%)
    for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
            if (mapa[y][x] !== 0) continue;
            if (zonasLibres.some(([cx, cy]) => cx === x && cy === y)) continue;

            if (rand() < 0.65) {
                mapa[y][x] = 2; // Bloque destructible

                // 30% de probabilidad de tener un power-up escondido
                if (rand() < 0.30) {
                    const r = rand();
                    let tipo;
                    if (r < 0.30) tipo = 'bomb';
                    else if (r < 0.60) tipo = 'fire';
                    else if (r < 0.85) tipo = 'speed';
                    else tipo = 'kick';
                    powerups[x + ',' + y] = tipo;
                }
            }
        }
    }

    return { mapa, powerups };
}

// ============================================================
//  FUNCIONES SUPABASE
// ============================================================
async function crearSala(id, nombre, seed) {
    const { error } = await sbClient.from('salas').insert({
        id, estado: 'esperando',
        timer_inicio: seed,  // Guardamos el seed del mapa aqui
        jugador1: { nombre },
        jugador2: null
    });
    if (error) throw error;
}

async function unirseASala(id, nombre) {
    const { error } = await sbClient.from('salas').update({
        jugador2: { nombre },
        estado: 'jugando'
    }).eq('id', id);
    if (error) throw error;
}

async function leerSala(id) {
    const { data, error } = await sbClient
        .from('salas').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}

function escucharSala(id, callback) {
    return sbClient.channel('db_' + id)
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'salas',
            filter: 'id=eq.' + id
        }, (payload) => { if (payload.new) callback(payload.new); })
        .subscribe();
}

// Canal Broadcast para sync rapido del juego (sin tocar la DB)
function crearCanalJuego(idSala) {
    const canal = sbClient.channel('game_' + idSala, {
        config: { broadcast: { self: false } }
    });
    estadoGlobal.canal = canal;
    return canal;
}

function broadcast(evento, datos) {
    if (estadoGlobal.canal) {
        estadoGlobal.canal.send({
            type: 'broadcast', event: evento, payload: datos
        });
    }
}

// ============================================================
//  UTILIDADES
// ============================================================
function generarIdSala() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 5; i++) id += c[Math.floor(Math.random() * c.length)];
    return id;
}

function gridToX(gx) { return GAME_OFFSET_X + gx * TILE + TILE / 2; }
function gridToY(gy) { return GAME_OFFSET_Y + gy * TILE + TILE / 2; }

// ============================================================
//  GENERADOR DE TEXTURAS PIXEL ART
//  Dibuja todos los sprites con Graphics API de Phaser
// ============================================================
function generarTexturas(scene) {
    const g = scene.make.graphics({ add: false });

    // --- PISO ---
    g.clear();
    g.fillStyle(0x3d8b37);
    g.fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x2d7a2d);
    g.fillRect(0, 0, TILE / 2, TILE / 2);
    g.fillRect(TILE / 2, TILE / 2, TILE / 2, TILE / 2);
    g.lineStyle(1, 0x4a9e44, 0.3);
    g.strokeRect(1, 1, TILE - 2, TILE - 2);
    g.generateTexture('floor', TILE, TILE);

    // --- MURO INDESTRUCTIBLE ---
    g.clear();
    g.fillStyle(0x555566);
    g.fillRect(0, 0, TILE, TILE);
    // Patron de ladrillos
    g.fillStyle(0x666677);
    g.fillRect(2, 2, 20, 10);
    g.fillRect(26, 2, 20, 10);
    g.fillRect(14, 16, 20, 10);
    g.fillRect(2, 30, 20, 10);
    g.fillRect(26, 30, 20, 10);
    g.fillRect(14, 16, 20, 10);
    // Lineas de mortero
    g.lineStyle(1, 0x444455);
    g.lineBetween(0, 14, TILE, 14);
    g.lineBetween(0, 28, TILE, 28);
    g.lineBetween(0, 42, TILE, 42);
    g.lineBetween(24, 0, 24, 14);
    g.lineBetween(12, 14, 12, 28);
    g.lineBetween(36, 14, 36, 28);
    g.lineBetween(24, 28, 24, 42);
    g.lineStyle(2, 0x3d3d4e);
    g.strokeRect(0, 0, TILE, TILE);
    g.generateTexture('wall', TILE, TILE);

    // --- BLOQUE DESTRUCTIBLE ---
    g.clear();
    g.fillStyle(0xbb8844);
    g.fillRect(0, 0, TILE, TILE);
    g.fillStyle(0xcc9955);
    g.fillRect(3, 3, TILE - 6, TILE - 6);
    g.fillStyle(0xddaa66);
    g.fillRect(6, 6, TILE - 12, TILE - 12);
    // Cruz decorativa
    g.lineStyle(2, 0xaa7733);
    g.lineBetween(TILE / 2, 4, TILE / 2, TILE - 4);
    g.lineBetween(4, TILE / 2, TILE - 4, TILE / 2);
    g.lineStyle(2, 0x996633);
    g.strokeRect(0, 0, TILE, TILE);
    g.generateTexture('block', TILE, TILE);

    // --- BOMBA ---
    g.clear();
    g.fillStyle(0x222222);
    g.fillCircle(TILE / 2, TILE / 2 + 4, 16);
    g.fillStyle(0x333333);
    g.fillCircle(TILE / 2, TILE / 2 + 4, 13);
    // Brillo
    g.fillStyle(0x666666);
    g.fillCircle(TILE / 2 - 5, TILE / 2 - 1, 4);
    // Mecha
    g.lineStyle(3, 0x886644);
    g.lineBetween(TILE / 2, TILE / 2 - 10, TILE / 2 + 6, TILE / 2 - 18);
    // Chispa
    g.fillStyle(0xff6600);
    g.fillCircle(TILE / 2 + 6, TILE / 2 - 18, 4);
    g.fillStyle(0xffcc00);
    g.fillCircle(TILE / 2 + 6, TILE / 2 - 18, 2);
    g.generateTexture('bomb', TILE, TILE);

    // --- EXPLOSION CENTRO ---
    g.clear();
    g.fillStyle(0xff4400);
    g.fillRect(4, 4, TILE - 8, TILE - 8);
    g.fillStyle(0xff8800);
    g.fillRect(8, 8, TILE - 16, TILE - 16);
    g.fillStyle(0xffcc00);
    g.fillRect(14, 14, TILE - 28, TILE - 28);
    g.fillStyle(0xffffff);
    g.fillRect(18, 18, TILE - 36, TILE - 36);
    g.generateTexture('exp_center', TILE, TILE);

    // --- EXPLOSION HORIZONTAL ---
    g.clear();
    g.fillStyle(0xff4400);
    g.fillRect(0, 8, TILE, TILE - 16);
    g.fillStyle(0xff8800);
    g.fillRect(0, 12, TILE, TILE - 24);
    g.fillStyle(0xffcc00);
    g.fillRect(0, 16, TILE, TILE - 32);
    g.generateTexture('exp_h', TILE, TILE);

    // --- EXPLOSION VERTICAL ---
    g.clear();
    g.fillStyle(0xff4400);
    g.fillRect(8, 0, TILE - 16, TILE);
    g.fillStyle(0xff8800);
    g.fillRect(12, 0, TILE - 24, TILE);
    g.fillStyle(0xffcc00);
    g.fillRect(16, 0, TILE - 32, TILE);
    g.generateTexture('exp_v', TILE, TILE);

    // --- JUGADOR 1 (Blanco/Azul) ---
    dibujarJugador(g, 0xffffff, 0xeeeeee, 0x4488ff, 'player1');

    // --- JUGADOR 2 (Negro/Rojo) ---
    dibujarJugador(g, 0x333333, 0x444444, 0xe94560, 'player2');

    // --- POWER-UPS ---
    dibujarPowerup(g, 0x9944cc, 'B', 'pu_bomb');   // +Bomba
    dibujarPowerup(g, 0xe94560, 'F', 'pu_fire');    // +Rango
    dibujarPowerup(g, 0x4488ff, 'S', 'pu_speed');   // +Velocidad
    dibujarPowerup(g, 0x44bb44, 'K', 'pu_kick');    // Patear

    // --- TUMBA (jugador muerto) ---
    g.clear();
    g.fillStyle(0x666666);
    g.fillRect(16, 20, 16, 24);
    g.fillRect(10, 20, 28, 6);
    g.fillStyle(0x888888);
    g.fillRect(18, 22, 12, 20);
    g.generateTexture('tumba', TILE, TILE);

    g.destroy();
}

function dibujarJugador(g, colorCuerpo, colorClaro, colorAccento, key) {
    g.clear();
    // Cuerpo
    g.fillStyle(colorAccento);
    g.fillRect(12, 22, 24, 18);
    // Cabeza
    g.fillStyle(colorCuerpo);
    g.fillCircle(TILE / 2, 16, 12);
    // Ojos
    g.fillStyle(0x000000);
    g.fillRect(18, 12, 4, 5);
    g.fillRect(26, 12, 4, 5);
    // Pupilas blancas
    g.fillStyle(0xffffff);
    g.fillRect(19, 13, 2, 2);
    g.fillRect(27, 13, 2, 2);
    // Antena de Bomberman
    g.fillStyle(colorAccento);
    g.fillRect(22, 0, 4, 8);
    g.fillCircle(TILE / 2, 2, 4);
    // Pies
    g.fillStyle(0x222222);
    g.fillRect(14, 40, 8, 6);
    g.fillRect(26, 40, 8, 6);
    // Cinturon
    g.fillStyle(colorClaro);
    g.fillRect(12, 30, 24, 3);
    g.generateTexture(key, TILE, TILE);
}

function dibujarPowerup(g, color, letra, key) {
    g.clear();
    // Fondo con brillo
    g.fillStyle(0x000000);
    g.fillRect(4, 4, TILE - 8, TILE - 8);
    g.fillStyle(color);
    g.fillRect(6, 6, TILE - 12, TILE - 12);
    g.fillStyle(0xffffff, 0.3);
    g.fillRect(8, 8, TILE - 16, 10);
    g.generateTexture(key, TILE, TILE);
    // Nota: la letra la pondremos como texto Phaser encima
}

// ============================================================
//  ESCENA: MENU PRINCIPAL
// ============================================================
class SceneMenu extends Phaser.Scene {
    constructor() { super({ key: 'SceneMenu' }); }

    create() {
        document.getElementById('loading-screen').style.display = 'none';
        generarTexturas(this);

        const W = 1280, H = 720;

        // Fondo con patron de piso
        for (let y = 0; y < Math.ceil(H / TILE); y++) {
            for (let x = 0; x < Math.ceil(W / TILE); x++) {
                this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'floor').setAlpha(0.3);
                if ((x + y) % 5 === 0 && Math.random() > 0.7) {
                    this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'wall').setAlpha(0.15);
                }
            }
        }

        // Titulo
        this.add.text(W / 2, 80, 'BOMBERMAN', {
            fontSize: '64px', fontFamily: 'Arial Black',
            color: '#e94560', stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5);

        this.add.text(W / 2, 130, '1 v 1  O N L I N E', {
            fontSize: '22px', color: '#ffcc44',
            fontFamily: 'Courier New', letterSpacing: 4
        }).setOrigin(0.5);

        // Jugadores decorativos
        const p1 = this.add.image(W / 2 - 200, 350, 'player1').setScale(2.5);
        const p2 = this.add.image(W / 2 + 200, 350, 'player2').setScale(2.5);
        this.add.image(W / 2, 350, 'bomb').setScale(2);
        this.tweens.add({ targets: p1, y: p1.y - 10, duration: 800, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: p2, y: p2.y - 10, duration: 800, yoyo: true, repeat: -1, delay: 400 });

        // --- NOMBRE ---
        this.add.text(W / 2, 190, 'Tu nombre:', { fontSize: '16px', color: '#aabbcc' }).setOrigin(0.5);
        this.inputNombre = this.crearInput(W / 2 - 100, 208, 200, 'Bomber');

        // --- CREAR SALA ---
        this.add.text(W / 2, 440, '- Crear Sala -', { fontSize: '14px', color: '#667788' }).setOrigin(0.5);
        this.crearBoton(W / 2, 480, 'CREAR SALA', 0xaa2244, () => this.accionCrear());

        this.textoIdSala = this.add.text(W / 2, 525, '', {
            fontSize: '32px', color: '#ffcc44', fontFamily: 'Courier New',
            stroke: '#000', strokeThickness: 4
        }).setOrigin(0.5);
        this.textoEspera = this.add.text(W / 2, 555, '', {
            fontSize: '13px', color: '#88aacc'
        }).setOrigin(0.5);

        // --- UNIRSE ---
        this.add.text(W / 2, 590, '- O Unirse -', { fontSize: '14px', color: '#667788' }).setOrigin(0.5);
        this.inputSala = this.crearInput(W / 2 - 80, 610, 160, 'ABCDE');
        this.crearBoton(W / 2, 665, 'UNIRSE', 0x226644, () => this.accionUnirse());

        // Estado
        this.textoEstado = this.add.text(W / 2, 705, '', {
            fontSize: '13px', color: '#ff6644'
        }).setOrigin(0.5);
    }

    crearInput(x, y, w, placeholder) {
        const inp = document.createElement('input');
        inp.type = 'text'; inp.placeholder = placeholder;
        const rect = this.game.canvas.getBoundingClientRect();
        const scaleX = rect.width / 1280;
        const scaleY = rect.height / 720;
        const scaledW = Math.round(w * scaleX);
        const scaledH = Math.round(30 * scaleY);
        const scaledFont = Math.round(15 * Math.min(scaleX, scaleY));
        const posLeft = Math.round(rect.left + window.scrollX + x * scaleX);
        const posTop = Math.round(rect.top + window.scrollY + y * scaleY);
        inp.style.cssText = `position:absolute;left:${posLeft}px;top:${posTop}px;
            width:${scaledW}px;height:${scaledH}px;font-size:${scaledFont}px;
            text-align:center;background:#16213e;color:#e94560;border:2px solid #0f3460;
            border-radius:4px;outline:none;font-family:Courier New,monospace;z-index:100;`;
        document.body.appendChild(inp);
        if (!this._inputs) this._inputs = [];
        this._inputs.push(inp);
        return inp;
    }

    crearBoton(x, y, texto, color, cb) {
        const btn = this.add.rectangle(x, y, 200, 40, color, 0.9)
            .setInteractive({ useHandCursor: true }).setStrokeStyle(2, 0xffffff);
        const lbl = this.add.text(x, y, texto, {
            fontSize: '16px', fontFamily: 'Arial Black', color: '#fff'
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
        const seed = Date.now(); // Seed para generar el mapa
        estadoGlobal = { idSala: id, nombreJugador: nombre, numJugador: 1, canal: null };
        this.textoEstado.setText('Creando...').setColor('#88aacc');

        try {
            await crearSala(id, nombre, seed);
            this.textoIdSala.setText(id);
            this.textoEspera.setText('Comparte este codigo con tu rival...');
            this.textoEstado.setText('');

            escucharSala(id, (datos) => {
                if (datos.estado === 'jugando' && datos.jugador2) {
                    this.textoEspera.setText('Rival: ' + datos.jugador2.nombre + ' - Iniciando!');
                    this.time.delayedCall(1000, () => {
                        this.limpiarInputs();
                        this.scene.start('SceneGame', { seed });
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

            // Leer el seed guardado en la sala (timer_inicio)
            const seed = datos.timer_inicio;

            estadoGlobal = { idSala: id, nombreJugador: nombre, numJugador: 2, canal: null };
            await unirseASala(id, nombre);
            this.textoEstado.setText('Conectado! Iniciando...');
            this.time.delayedCall(800, () => {
                this.limpiarInputs();
                this.scene.start('SceneGame', { seed });
            });
        } catch (e) {
            this.textoEstado.setText('Error: ' + (e.message || e)).setColor('#ff4444');
        }
    }
}

// ============================================================
//  ESCENA: JUEGO PRINCIPAL (Bomberman)
// ============================================================
class SceneGame extends Phaser.Scene {
    constructor() { super({ key: 'SceneGame' }); }

    init(data) {
        this.seedInicial = data.seed || null;
    }

    create() {
        const W = 1280, H = 720;

        // --- Variables del juego ---
        this.mapa = null;
        this.powerupsData = {};
        this.tileSprites = [];
        this.bombs = [];
        this.explosiones = [];
        this.powerupSprites = {};
        this.juegoActivo = false;
        this.syncTimer = 0;
        this.kickedBombs = [];

        // Jugador local
        this.local = {
            gridX: 1, gridY: 1, // P1 default
            pixelX: 0, pixelY: 0,
            moving: false, targetX: 0, targetY: 0,
            dir: 'down',
            speed: BASE_SPEED,
            maxBombs: 1, bombsOut: 0,
            fireRange: 1,
            hasKick: false,
            alive: true
        };

        // Jugador remoto
        this.remoto = {
            gridX: COLS - 2, gridY: ROWS - 2, // P2 default
            pixelX: 0, pixelY: 0,
            dir: 'down', alive: true,
            speed: BASE_SPEED, maxBombs: 1, fireRange: 1, hasKick: false, bombsOut: 0
        };

        // Asignar posiciones segun numero de jugador
        if (estadoGlobal.numJugador === 2) {
            this.local.gridX = COLS - 2;
            this.local.gridY = ROWS - 2;
            this.remoto.gridX = 1;
            this.remoto.gridY = 1;
        }

        this.local.pixelX = gridToX(this.local.gridX);
        this.local.pixelY = gridToY(this.local.gridY);
        this.remoto.pixelX = gridToX(this.remoto.gridX);
        this.remoto.pixelY = gridToY(this.remoto.gridY);

        // --- Fondo oscuro ---
        this.add.rectangle(W / 2, H / 2, W, H, 0x16213e);

        if (!ES_MOVIL) {
            // --- Panel izquierdo (stats) - SOLO DESKTOP ---
            this.add.rectangle(140, H / 2, 260, H - 20, 0x0f3460, 0.5).setStrokeStyle(1, 0x1a3a5c);
            this.add.text(140, 30, 'BOMBERMAN 1v1', {
                fontSize: '18px', fontFamily: 'Arial Black', color: '#e94560'
            }).setOrigin(0.5);

            const p1Color = estadoGlobal.numJugador === 1 ? '#4488ff' : '#e94560';
            const p2Color = estadoGlobal.numJugador === 1 ? '#e94560' : '#4488ff';
            const p1Label = estadoGlobal.numJugador === 1 ? 'TU' : 'RIVAL';
            const p2Label = estadoGlobal.numJugador === 1 ? 'RIVAL' : 'TU';

            this.add.image(60, 80, 'player1').setScale(0.8);
            this.add.text(90, 75, p1Label, { fontSize: '14px', color: p1Color, fontFamily: 'Arial Black' });
            this.textoStatsP1 = this.add.text(40, 110, '', { fontSize: '11px', color: '#aabbcc', lineSpacing: 3 });

            this.add.image(60, 200, 'player2').setScale(0.8);
            this.add.text(90, 195, p2Label, { fontSize: '14px', color: p2Color, fontFamily: 'Arial Black' });
            this.textoStatsP2 = this.add.text(40, 230, '', { fontSize: '11px', color: '#aabbcc', lineSpacing: 3 });

            this.add.text(140, 360, 'CONTROLES', {
                fontSize: '13px', color: '#667788', fontFamily: 'Arial Black'
            }).setOrigin(0.5);
            this.add.text(30, 385, [
                'WASD / Flechas = Mover',
                'ESPACIO = Bomba',
                '',
                'Power-ups:',
                'B = +1 Bomba',
                'F = +1 Rango fuego',
                'S = +Velocidad',
                'K = Patear bombas'
            ].join('\n'), { fontSize: '11px', color: '#556677', lineSpacing: 4 });

            this.textoEstadoJuego = this.add.text(140, 560, 'Conectando...', {
                fontSize: '14px', color: '#ffcc44'
            }).setOrigin(0.5);
        } else {
            // --- MOVIL: Mini HUD compacto superpuesto ---
            this.textoStatsP1 = this.add.text(0, 0, '', { fontSize: '1px', color: '#000' }).setVisible(false);
            this.textoStatsP2 = this.add.text(0, 0, '', { fontSize: '1px', color: '#000' }).setVisible(false);

            // Barra superior con info minima
            this.add.rectangle(W / 2, 8, W, 16, 0x000000, 0.6).setDepth(150);
            const miColor = estadoGlobal.numJugador === 1 ? '#4488ff' : '#e94560';
            const rivColor = estadoGlobal.numJugador === 1 ? '#e94560' : '#4488ff';
            this.mobileStatsLocal = this.add.text(10, 2, '', {
                fontSize: '10px', color: miColor, fontFamily: 'Arial Black'
            }).setDepth(151);
            this.mobileStatsRemoto = this.add.text(W - 10, 2, '', {
                fontSize: '10px', color: rivColor, fontFamily: 'Arial Black'
            }).setOrigin(1, 0).setDepth(151);

            this.textoEstadoJuego = this.add.text(W / 2, 2, 'Conectando...', {
                fontSize: '10px', color: '#ffcc44'
            }).setOrigin(0.5, 0).setDepth(151);
        }

        this.textoCuenta = this.add.text(W / 2, H / 2, '', {
            fontSize: '96px', fontFamily: 'Arial Black',
            color: '#ffffff', stroke: '#000000', strokeThickness: 10
        }).setOrigin(0.5).setDepth(100);

        // --- Teclado ---
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys({
            W: Phaser.Input.Keyboard.KeyCodes.W,
            A: Phaser.Input.Keyboard.KeyCodes.A,
            S: Phaser.Input.Keyboard.KeyCodes.S,
            D: Phaser.Input.Keyboard.KeyCodes.D,
            SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE
        });

        // --- Controles tactiles para movil ---
        this.esTactil = ES_MOVIL || !this.sys.game.device.os.desktop;
        this.touchDir = null;   // Direccion actual del D-pad
        this.touchBomb = false; // Boton bomba presionado
        if (this.esTactil) {
            this.crearControlesTactiles();
        }

        // --- Iniciar mapa inmediatamente (ambos tienen el seed) ---
        this.iniciarConSeed(this.seedInicial);

        // --- Conectar canal Broadcast para sync del juego ---
        this.conectarCanal();
    }

    // ========== CONTROLES TACTILES PARA MOVIL ==========
    crearControlesTactiles() {
        const W = 1280, H = 720;
        // Calcular posicion del D-pad: debajo del mapa, lado izquierdo
        const mapaBottom = GAME_OFFSET_Y + ROWS * TILE;
        const espacioAbajo = H - mapaBottom;
        const dpadY = mapaBottom + espacioAbajo / 2 + 10;
        const dpadX = 120;
        const btnSize = 52;
        const depth = 200;
        const alpha = 0.45;

        // Fondo semi-transparente del D-pad
        this.add.circle(dpadX, dpadY, 82, 0x000000, 0.25).setDepth(depth - 1);

        // Boton ARRIBA
        const btnUp = this.add.rectangle(dpadX, dpadY - btnSize, btnSize, btnSize, 0x4488ff, alpha)
            .setDepth(depth).setInteractive().setStrokeStyle(2, 0xffffff, 0.3);
        this.add.text(dpadX, dpadY - btnSize, '\u25B2', {
            fontSize: '22px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(depth + 1).setAlpha(0.7);

        // Boton ABAJO
        const btnDown = this.add.rectangle(dpadX, dpadY + btnSize, btnSize, btnSize, 0x4488ff, alpha)
            .setDepth(depth).setInteractive().setStrokeStyle(2, 0xffffff, 0.3);
        this.add.text(dpadX, dpadY + btnSize, '\u25BC', {
            fontSize: '22px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(depth + 1).setAlpha(0.7);

        // Boton IZQUIERDA
        const btnLeft = this.add.rectangle(dpadX - btnSize, dpadY, btnSize, btnSize, 0x4488ff, alpha)
            .setDepth(depth).setInteractive().setStrokeStyle(2, 0xffffff, 0.3);
        this.add.text(dpadX - btnSize, dpadY, '\u25C0', {
            fontSize: '22px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(depth + 1).setAlpha(0.7);

        // Boton DERECHA
        const btnRight = this.add.rectangle(dpadX + btnSize, dpadY, btnSize, btnSize, 0x4488ff, alpha)
            .setDepth(depth).setInteractive().setStrokeStyle(2, 0xffffff, 0.3);
        this.add.text(dpadX + btnSize, dpadY, '\u25B6', {
            fontSize: '22px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(depth + 1).setAlpha(0.7);

        // --- BOTON BOMBA (grande, lado derecho inferior) ---
        const bombX = W - 120;
        const bombY = dpadY;
        const btnBomb = this.add.circle(bombX, bombY, 50, 0xe94560, 0.55)
            .setDepth(depth).setInteractive().setStrokeStyle(3, 0xffffff, 0.4);
        this.add.text(bombX, bombY - 8, '\uD83D\uDCA3', {
            fontSize: '28px'
        }).setOrigin(0.5).setDepth(depth + 1);
        this.add.text(bombX, bombY + 20, 'BOMBA', {
            fontSize: '10px', fontFamily: 'Arial Black', color: '#ffffff'
        }).setOrigin(0.5).setDepth(depth + 1).setAlpha(0.8);

        // --- Eventos tactiles del D-pad ---
        const configurarDpad = (btn, dir) => {
            btn.on('pointerdown', () => {
                this.touchDir = dir;
                btn.setFillStyle(0x66aaff, 0.8);
            });
            btn.on('pointerup', () => {
                this.touchDir = null;
                btn.setFillStyle(0x4488ff, alpha);
            });
            btn.on('pointerout', () => {
                this.touchDir = null;
                btn.setFillStyle(0x4488ff, alpha);
            });
        };

        configurarDpad(btnUp, 'up');
        configurarDpad(btnDown, 'down');
        configurarDpad(btnLeft, 'left');
        configurarDpad(btnRight, 'right');

        // --- Evento del boton bomba ---
        btnBomb.on('pointerdown', () => {
            this.touchBomb = true;
            btnBomb.setFillStyle(0xff6680, 0.9);
        });
        btnBomb.on('pointerup', () => {
            btnBomb.setFillStyle(0xe94560, 0.6);
        });
        btnBomb.on('pointerout', () => {
            btnBomb.setFillStyle(0xe94560, 0.6);
        });
    }

    // ========== CONEXION MULTIPLAYER ==========
    conectarCanal() {
        const canal = crearCanalJuego(estadoGlobal.idSala);

        // Escuchar movimiento del otro jugador
        canal.on('broadcast', { event: 'move' }, ({ payload }) => {
            this.remoto.gridX = payload.gx;
            this.remoto.gridY = payload.gy;
            this.remoto.pixelX = payload.px;
            this.remoto.pixelY = payload.py;
            this.remoto.dir = payload.dir;
            if (this.remotoSprite) {
                this.remotoSprite.setPosition(payload.px, payload.py);
            }
        });

        // Escuchar bombas del otro jugador
        canal.on('broadcast', { event: 'bomb' }, ({ payload }) => {
            this.crearBomba(payload.x, payload.y, payload.range, false);
        });

        // Escuchar muerte del otro jugador
        canal.on('broadcast', { event: 'muerte' }, ({ payload }) => {
            this.remoto.alive = false;
            if (this.remotoSprite) this.remotoSprite.setTexture('tumba');
            this.finalizarPartida(true);
        });

        // Escuchar kick de bombas
        canal.on('broadcast', { event: 'kick' }, ({ payload }) => {
            const bomba = this.bombs.find(b => b.gridX === payload.ox && b.gridY === payload.oy);
            if (bomba) this.iniciarKick(bomba, payload.dir);
        });

        canal.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                this.textoEstadoJuego.setText('Conectado!');
            }
        });
    }

    // ========== INICIAR PARTIDA CON SEED ==========
    iniciarConSeed(seed) {
        if (this.mapa) return; // Ya se inicio

        const resultado = generarMapa(seed);
        this.mapa = resultado.mapa;
        this.powerupsData = resultado.powerups;

        this.dibujarMapa();
        this.crearJugadores();

        // Cuenta regresiva 3-2-1-GO!
        this.textoEstadoJuego.setText('Preparate!');
        let cuenta = 3;
        this.textoCuenta.setText(cuenta.toString());

        const timer = this.time.addEvent({
            delay: 800,
            callback: () => {
                cuenta--;
                if (cuenta > 0) {
                    this.textoCuenta.setText(cuenta.toString());
                } else if (cuenta === 0) {
                    this.textoCuenta.setText('GO!');
                } else {
                    this.textoCuenta.setText('');
                    this.juegoActivo = true;
                    this.textoEstadoJuego.setText('En juego!');
                    timer.remove();
                }
            },
            loop: true
        });
    }

    // ========== DIBUJAR MAPA ==========
    dibujarMapa() {
        for (let y = 0; y < ROWS; y++) {
            this.tileSprites[y] = [];
            for (let x = 0; x < COLS; x++) {
                const px = gridToX(x);
                const py = gridToY(y);

                // Siempre poner piso debajo
                this.add.image(px, py, 'floor');

                let key = null;
                if (this.mapa[y][x] === 1) key = 'wall';
                else if (this.mapa[y][x] === 2) key = 'block';

                if (key) {
                    this.tileSprites[y][x] = this.add.image(px, py, key);
                } else {
                    this.tileSprites[y][x] = null;
                }
            }
        }

        // Borde del area de juego
        this.add.rectangle(
            GAME_OFFSET_X + COLS * TILE / 2,
            GAME_OFFSET_Y + ROWS * TILE / 2,
            COLS * TILE + 4, ROWS * TILE + 4
        ).setStrokeStyle(2, 0xe94560).setFillStyle(0, 0);
    }

    // ========== CREAR JUGADORES ==========
    crearJugadores() {
        const localKey = estadoGlobal.numJugador === 1 ? 'player1' : 'player2';
        const remotoKey = estadoGlobal.numJugador === 1 ? 'player2' : 'player1';

        this.localSprite = this.add.image(this.local.pixelX, this.local.pixelY, localKey).setDepth(10);
        this.remotoSprite = this.add.image(this.remoto.pixelX, this.remoto.pixelY, remotoKey).setDepth(10);
    }

    // ========== UPDATE (cada frame) ==========
    update(time, delta) {
        if (!this.juegoActivo || !this.local.alive) return;

        this.manejarMovimiento(delta);
        this.manejarBombas(delta);
        this.actualizarBombasKicked(delta);
        this.actualizarStats();

        // Sync periodico
        this.syncTimer += delta;
        if (this.syncTimer >= SYNC_INTERVAL) {
            this.syncTimer = 0;
            broadcast('move', {
                gx: this.local.gridX, gy: this.local.gridY,
                px: this.local.pixelX, py: this.local.pixelY,
                dir: this.local.dir
            });
        }

        // Colocar bomba (teclado o tactil)
        if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) || this.touchBomb) {
            this.ponerBomba();
            this.touchBomb = false;
        }
    }

    // ========== MOVIMIENTO ==========
    manejarMovimiento(delta) {
        if (this.local.moving) {
            // Mover hacia el target
            const dx = this.local.targetX - this.local.pixelX;
            const dy = this.local.targetY - this.local.pixelY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const step = this.local.speed * delta / 1000;

            if (dist <= step + 1) {
                // Llego al destino
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

            // Teclado
            if (this.cursors.left.isDown || this.keys.A.isDown) { dx = -1; dir = 'left'; }
            else if (this.cursors.right.isDown || this.keys.D.isDown) { dx = 1; dir = 'right'; }
            else if (this.cursors.up.isDown || this.keys.W.isDown) { dy = -1; dir = 'up'; }
            else if (this.cursors.down.isDown || this.keys.S.isDown) { dy = 1; dir = 'down'; }
            // Tactil (D-pad)
            else if (this.touchDir === 'left') { dx = -1; dir = 'left'; }
            else if (this.touchDir === 'right') { dx = 1; dir = 'right'; }
            else if (this.touchDir === 'up') { dy = -1; dir = 'up'; }
            else if (this.touchDir === 'down') { dy = 1; dir = 'down'; }

            if (dir) {
                this.local.dir = dir;
                const nx = this.local.gridX + dx;
                const ny = this.local.gridY + dy;

                if (this.puedeMover(nx, ny)) {
                    this.local.gridX = nx;
                    this.local.gridY = ny;
                    this.local.targetX = gridToX(nx);
                    this.local.targetY = gridToY(ny);
                    this.local.moving = true;
                } else {
                    // Intentar patear bomba si tiene el power-up
                    if (this.local.hasKick) {
                        const bomba = this.bombs.find(b => b.gridX === nx && b.gridY === ny && !b.kicking);
                        if (bomba) {
                            this.iniciarKick(bomba, dir);
                            broadcast('kick', { ox: nx, oy: ny, dir });
                        }
                    }
                }
            }
        }

        if (this.localSprite) {
            this.localSprite.setPosition(this.local.pixelX, this.local.pixelY);
        }
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
        const px = gridToX(gx), py = gridToY(gy);
        const sprite = this.add.image(px, py, 'bomb').setDepth(5);

        // Animacion de pulso
        this.tweens.add({
            targets: sprite, scaleX: 1.15, scaleY: 1.15,
            duration: 300, yoyo: true, repeat: -1
        });

        const bomba = { gridX: gx, gridY: gy, timer: BOMB_TIMER, range, sprite, esLocal, kicking: false };
        this.bombs.push(bomba);
        if (esLocal) this.local.bombsOut++;
    }

    manejarBombas(delta) {
        const bombasExplotar = [];

        this.bombs.forEach(b => {
            if (b.kicking) return; // Las kicked se manejan aparte
            b.timer -= delta;
            if (b.timer <= 0) bombasExplotar.push(b);
        });

        bombasExplotar.forEach(b => this.explotarBomba(b));
    }

    explotarBomba(bomba) {
        // Remover bomba
        bomba.sprite.destroy();
        this.bombs = this.bombs.filter(b => b !== bomba);
        if (bomba.esLocal) this.local.bombsOut = Math.max(0, this.local.bombsOut - 1);

        const { gridX, gridY, range } = bomba;
        const tilesAfectados = [{ x: gridX, y: gridY }];

        // Expandir en 4 direcciones
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        dirs.forEach(([dx, dy]) => {
            for (let i = 1; i <= range; i++) {
                const nx = gridX + dx * i;
                const ny = gridY + dy * i;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) break;
                if (this.mapa[ny][nx] === 1) break; // Muro para

                tilesAfectados.push({ x: nx, y: ny });

                if (this.mapa[ny][nx] === 2) {
                    // Destruir bloque
                    this.destruirBloque(nx, ny);
                    break; // Bloque para la explosion
                }
            }
        });

        // Crear sprites de explosion
        const expSprites = tilesAfectados.map(({ x, y }) => {
            const isCenter = x === gridX && y === gridY;
            const key = isCenter ? 'exp_center' :
                (x !== gridX ? 'exp_h' : 'exp_v');
            return this.add.image(gridToX(x), gridToY(y), key).setDepth(8).setAlpha(0.9);
        });

        // Guardar explosion activa
        const exp = { tiles: tilesAfectados, sprites: expSprites };
        this.explosiones.push(exp);

        // Cadena: si hay otra bomba en la zona, explotarla
        this.bombs.forEach(b => {
            if (tilesAfectados.some(t => t.x === b.gridX && t.y === b.gridY)) {
                b.timer = 0;
            }
        });

        // Verificar muerte del jugador local
        if (this.local.alive && tilesAfectados.some(t => t.x === this.local.gridX && t.y === this.local.gridY)) {
            this.morir();
        }

        // Verificar muerte del remoto
        if (this.remoto.alive && tilesAfectados.some(t => t.x === this.remoto.gridX && t.y === this.remoto.gridY)) {
            this.remoto.alive = false;
            if (this.remotoSprite) this.remotoSprite.setTexture('tumba');
            this.finalizarPartida(true); // Yo gano
        }

        // Eliminar explosion despues de EXPLOSION_DURATION
        this.time.delayedCall(EXPLOSION_DURATION, () => {
            expSprites.forEach(s => s.destroy());
            this.explosiones = this.explosiones.filter(e => e !== exp);
        });

        // Sonido/efecto
        this.cameras.main.shake(100, 0.005);
    }

    destruirBloque(x, y) {
        this.mapa[y][x] = 0;
        if (this.tileSprites[y][x]) {
            this.tileSprites[y][x].destroy();
            this.tileSprites[y][x] = null;
        }

        // Verificar si hay power-up escondido
        const key = x + ',' + y;
        if (this.powerupsData[key]) {
            const tipo = this.powerupsData[key];
            const texKey = 'pu_' + tipo;
            const px = gridToX(x), py = gridToY(y);
            const sprite = this.add.image(px, py, texKey).setDepth(3);

            // Letra encima del power-up
            const letras = { bomb: 'B', fire: 'F', speed: 'S', kick: 'K' };
            const txt = this.add.text(px, py, letras[tipo], {
                fontSize: '20px', fontFamily: 'Arial Black', color: '#ffffff',
                stroke: '#000000', strokeThickness: 3
            }).setOrigin(0.5).setDepth(4);

            this.powerupSprites[key] = { sprite, txt, tipo, x, y };

            // Animacion de aparicion
            sprite.setScale(0);
            txt.setScale(0);
            this.tweens.add({ targets: [sprite, txt], scale: 1, duration: 300, ease: 'Back.easeOut' });
        }
    }

    // ========== POWER-UPS ==========
    checkPowerup(gx, gy) {
        const key = gx + ',' + gy;
        const pu = this.powerupSprites[key];
        if (!pu) return;

        // Recoger power-up
        switch (pu.tipo) {
            case 'bomb': this.local.maxBombs++; break;
            case 'fire': this.local.fireRange++; break;
            case 'speed': this.local.speed += SPEED_BOOST; break;
            case 'kick': this.local.hasKick = true; break;
        }

        // Destruir visualmente
        pu.sprite.destroy();
        pu.txt.destroy();
        delete this.powerupSprites[key];
        delete this.powerupsData[key];

        // Efecto visual de recoger
        const efecto = this.add.text(gridToX(gx), gridToY(gy) - 20, '+' + pu.tipo.toUpperCase(), {
            fontSize: '14px', fontFamily: 'Arial Black', color: '#ffcc44',
            stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(20);
        this.tweens.add({
            targets: efecto, y: efecto.y - 40, alpha: 0,
            duration: 800, onComplete: () => efecto.destroy()
        });
    }

    checkExplosion(gx, gy) {
        if (this.explosiones.some(e => e.tiles.some(t => t.x === gx && t.y === gy))) {
            this.morir();
        }
    }

    // ========== KICK DE BOMBAS ==========
    iniciarKick(bomba, dir) {
        bomba.kicking = true;
        const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
        bomba.kickDx = dirs[dir][0];
        bomba.kickDy = dirs[dir][1];
        bomba.kickProgress = 0;
        this.kickedBombs.push(bomba);
    }

    actualizarBombasKicked(delta) {
        const velocidadKick = 6; // tiles por segundo
        const parar = [];

        this.kickedBombs.forEach(b => {
            b.timer -= delta; // La bomba sigue contando

            b.kickProgress += velocidadKick * delta / 1000;

            if (b.kickProgress >= 1) {
                b.kickProgress = 0;
                const nx = b.gridX + b.kickDx;
                const ny = b.gridY + b.kickDy;

                // Verificar si puede seguir
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS ||
                    this.mapa[ny][nx] !== 0 ||
                    this.bombs.some(ob => ob !== b && ob.gridX === nx && ob.gridY === ny)) {
                    // Parar aqui
                    b.kicking = false;
                    parar.push(b);
                } else {
                    b.gridX = nx;
                    b.gridY = ny;
                }
            }

            // Actualizar posicion visual
            const fraccion = b.kickProgress;
            const baseX = gridToX(b.gridX);
            const baseY = gridToY(b.gridY);
            b.sprite.setPosition(
                baseX + b.kickDx * fraccion * TILE,
                baseY + b.kickDy * fraccion * TILE
            );

            // Explotar si timer llego a 0
            if (b.timer <= 0) {
                b.kicking = false;
                parar.push(b);
                this.explotarBomba(b);
            }
        });

        this.kickedBombs = this.kickedBombs.filter(b => !parar.includes(b));
    }

    // ========== MUERTE ==========
    morir() {
        if (!this.local.alive) return;
        this.local.alive = false;
        this.juegoActivo = false;

        if (this.localSprite) this.localSprite.setTexture('tumba');

        // Avisar al otro jugador
        broadcast('muerte', { jugador: estadoGlobal.numJugador });

        // Pantalla de derrota
        this.finalizarPartida(false);
    }

    finalizarPartida(gane) {
        this.juegoActivo = false;

        this.time.delayedCall(1500, () => {
            this.scene.start('SceneResult', { gane });
        });
    }

    // ========== ACTUALIZAR STATS UI ==========
    actualizarStats() {
        const miStats = this.local;
        const rivStats = this.remoto;

        if (ES_MOVIL) {
            // Mini HUD movil - solo iconos compactos
            const fmtMini = (s, label) =>
                `${label} B:${s.maxBombs} F:${s.fireRange} S:${Math.round((s.speed / BASE_SPEED) * 100)}%${s.hasKick ? ' K' : ''}`;
            if (this.mobileStatsLocal) this.mobileStatsLocal.setText(fmtMini(miStats, 'TU'));
            if (this.mobileStatsRemoto) this.mobileStatsRemoto.setText(fmtMini(rivStats, 'RIVAL'));
        } else {
            const formatStats = (s) =>
                `Bombas: ${s.maxBombs} | Fuego: ${s.fireRange}\n` +
                `Velocidad: ${Math.round((s.speed / BASE_SPEED) * 100)}%\n` +
                `Patear: ${s.hasKick ? 'SI' : 'NO'}`;

            if (estadoGlobal.numJugador === 1) {
                this.textoStatsP1.setText(formatStats(miStats));
                this.textoStatsP2.setText(formatStats(rivStats));
            } else {
                this.textoStatsP1.setText(formatStats(rivStats));
                this.textoStatsP2.setText(formatStats(miStats));
            }
        }
    }
}

// ============================================================
//  ESCENA: RESULTADO
// ============================================================
class SceneResult extends Phaser.Scene {
    constructor() { super({ key: 'SceneResult' }); }

    init(data) { this.gane = data.gane; }

    create() {
        const W = 1280, H = 720;

        // Fondo con tiles
        for (let y = 0; y < Math.ceil(H / TILE); y++) {
            for (let x = 0; x < Math.ceil(W / TILE); x++) {
                this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'floor').setAlpha(0.2);
            }
        }
        this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7);

        // Resultado
        const texto = this.gane ? 'VICTORIA!' : 'DERROTA...';
        const color = this.gane ? '#44ff88' : '#e94560';
        const emoji = this.gane ? 'player1' : 'tumba';

        const titulo = this.add.text(W / 2, 200, texto, {
            fontSize: '80px', fontFamily: 'Arial Black',
            color: color, stroke: '#000000', strokeThickness: 10
        }).setOrigin(0.5).setScale(0);
        this.tweens.add({ targets: titulo, scale: 1, duration: 600, ease: 'Back.easeOut' });

        // Icono grande
        const icono = this.add.image(W / 2, 350, emoji).setScale(3).setAlpha(0);
        this.tweens.add({ targets: icono, alpha: 1, duration: 800, delay: 400 });

        // Boton jugar de nuevo
        const btn = this.add.rectangle(W / 2, 500, 280, 55, 0xaa2244, 0.9)
            .setStrokeStyle(2, 0xffffff)
            .setInteractive({ useHandCursor: true });
        const btnLbl = this.add.text(W / 2, 500, 'JUGAR DE NUEVO', {
            fontSize: '20px', fontFamily: 'Arial Black', color: '#fff'
        }).setOrigin(0.5);

        btn.on('pointerover', () => { btn.setScale(1.05); btnLbl.setScale(1.05); });
        btn.on('pointerout', () => { btn.setScale(1); btnLbl.setScale(1); });
        btn.on('pointerdown', () => {
            if (estadoGlobal.canal) {
                sbClient.removeChannel(estadoGlobal.canal);
                estadoGlobal.canal = null;
            }
            estadoGlobal.idSala = null;
            estadoGlobal.numJugador = null;
            this.scene.start('SceneMenu');
        });

        // Tip
        this.add.text(W / 2, 600, 'Abre 2 pestanas en localhost:8000 para probar local', {
            fontSize: '12px', color: '#556677'
        }).setOrigin(0.5);
    }
}

// ============================================================
//  CONFIGURACION PHASER
// ============================================================
const config = {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    parent: 'game-container',
    backgroundColor: '#1a1a2e',
    pixelArt: true,  // Renderizado pixelado, sin antialiasing
    scene: [SceneMenu, SceneGame, SceneResult],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

const game = new Phaser.Game(config);
