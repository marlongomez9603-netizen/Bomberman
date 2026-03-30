# Contexto del Proyecto: Mini-OGame Animado 1vs1

> **Para el AI que recibe este archivo:** Este documento resume una conversación de diseño completa para un videojuego de navegador. El usuario ya tiene las decisiones de diseño tomadas. Tu tarea es continuar desde donde se dejó — específicamente: **escribir el código base del juego en Phaser 3 + Firebase**.

---

## ¿Qué es este proyecto?

Un juego tipo **OGame** (estrategia espacial de construcción de recursos y combate de naves), pero con estas diferencias clave:

- **Animado:** Se ven los robots extrayendo recursos, las naves moviéndose, las explosiones en batalla
- **1 vs 1:** Solo dos jugadores humanos, por invitación directa
- **Corto:** Máximo **15 minutos por partida** (10 min construcción + 5 min batalla)
- **Gratis y sin servidor:** Se juega desde **GitHub Pages** usando **Firebase Realtime Database** como backend en tiempo real
- **Assets propios:** Las imágenes se generaron o se van a generar con **Google Nano Banana Pro**

---

## Stack Tecnológico Decidido

| Capa | Herramienta | Notas |
|---|---|---|
| Motor de juego | **Phaser 3** (CDN) | Maneja sprites, animaciones, escenas, física 2D |
| Multijugador | **Firebase Realtime Database** | Sincroniza estado entre jugadores sin servidor |
| Hosting | **GitHub Pages** | El archivo `index.html` se sube al repo y se activa Pages |
| Assets visuales | **Google Nano Banana Pro** | Imágenes PNG generadas con prompts, fondo verde #00FF00 para chroma key |
| Editor | **VS Code** local | Sin terminal ni npm necesarios para empezar |

### Estructura de archivos del proyecto

```
mi-juego/
├── index.html          ← archivo principal (carga Phaser + Firebase)
├── game.js             ← todo el código del juego
└── assets/
    ├── naves/
    ├── edificios/
    ├── efectos/
    └── planetas/
```

---

## Flujo del Juego

```
PANTALLA 1: MENÚ
  └─ Jugador 1: crea sala (genera ID único)
  └─ Jugador 2: ingresa ID y se une

FASE 1 — CONSTRUCCIÓN (10 minutos)
  ├─ Cada jugador ve su propio planeta animado
  ├─ Los mineros/robots extraen recursos visualmente (sprite animado en loop)
  ├─ Se construyen edificios y se investigan tecnologías con los recursos
  ├─ Se fabrican naves en el Astillero
  ├─ Timer visible sincronizado vía Firebase para ambos jugadores
  └─ Mini-vista del planeta enemigo (solo lectura)

FASE 2 — BATALLA (5 minutos o automático al vencer timer)
  ├─ Ambos jugadores pasan a la ScenaBatalla simultáneamente
  ├─ Las flotas se mueven hacia el centro y se enfrentan
  ├─ Animación de combate: naves se mueven, disparan, explotan
  └─ Se calculan daños según stats y counters

PANTALLA FINAL: RESULTADO
  └─ Ganador, stats de la partida, recursos gastados
```

---

## Recursos del Juego

| Recurso | Fuente | Uso | Animación |
|---|---|---|---|
| 🪨 Metal | Mina de Metal | Estructuras y naves | Robots excavando, chunks volando |
| 💎 Cristal | Cristalizador | Tecnologías y escudos | Cristales creciendo del suelo |
| ⚡ Energía | Reactor Solar | Multiplica producción | Rayos pulsando desde paneles |

**Regla clave de energía:** Sin suficiente energía, las minas producen al 50%.

---

## Árbol de Edificios

Cada edificio tiene 3 niveles. Costos en Metal (M) y Cristal (C):

### Mina de Metal (disponible desde el inicio)
- Nv1 → +10 metal/seg | gratis
- Nv2 → +25 metal/seg | 150M
- Nv3 → +50 metal/seg | 400M + 100C

### Cristalizador (desbloquea a los 30 seg)
- Nv1 → +5 cristal/seg | 100M
- Nv2 → +12 cristal/seg | 200M + 50C
- Nv3 → +25 cristal/seg | 500M + 200C

### Reactor Solar
- Nv1 → producción +20% | 75M + 30C
- Nv2 → producción +50% | 200M + 100C
- Nv3 → producción +100% | 600M + 250C

### Laboratorio (requiere: Mina Nv2)
- Desbloquea árbol de tecnologías

### Astillero (requiere: Cristalizador Nv1 + Mina Nv2)
- Desbloquea construcción de naves

---

## Árbol de Tecnologías

Solo 4 tecnologías, máximo 2 niveles. **No se puede investigar todo** en 10 min — es la decisión estratégica:

| Tecnología | Nv1 | Nv2 | Costo Nv1 | Desbloquea |
|---|---|---|---|---|
| 🔥 Propulsión | +20% vel | +50% vel | 100C | Caza Avanzado |
| 🛡️ Blindaje | +25% HP | +60% HP | 150M+80C | Crucero |
| ⚔️ Armamento | +20% daño | +50% daño | 200M+100C | Bombardero |
| 🌀 Escudo | Absorbe 15% daño | Absorbe 35% daño | 80C | Defensa avanzada |

---

## Las 5 Naves

| Nave | HP | ATK | VEL | Costo | Tiempo | Requiere |
|---|---|---|---|---|---|---|
| 🛸 Caza Ligero | 80 | 15 | ★★★★★ | 60M+20C | 8 seg | Nada |
| 🚀 Fragata | 200 | 35 | ★★★ | 180M+60C | 18 seg | Astillero |
| ⚡ Caza Avanzado | 120 | 25 | ★★★★★+ | 100M+80C | 12 seg | Propulsión Nv1 |
| 🛡️ Crucero | 600 | 80 | ★★ | 500M+200C | 40 seg | Blindaje Nv1 |
| 💣 Bombardero | 150 | 120 | ★ | 300M+300C | 35 seg | Armamento Nv1 |

### Sistema de Counters (piedra-papel-tijera)
```
Cazas x10    → DESTROZAN → Bombarderos
Bombarderos  → DESTROZAN → Cruceros + Defensas
Cruceros     → DESTROZAN → Fragatas + Cazas Avanzados
Fragatas     → DESTROZAN → Cazas Ligeros
```

---

## Defensas del Planeta

| Defensa | HP | ATK | Costo | Efectiva contra |
|---|---|---|---|---|
| 🔫 Torreta Ligera | 300 | 20 | 80M+30C | Cazas |
| 🧱 Cañón Pesado | 800 | 90 | 300M+150C | Cruceros/Fragatas |
| 🌐 Cúpula de Escudo | 2000 | 0 | 200C | Absorbe primer impacto |

---

## Estrategias Base (3 arquetipos conocidos)

- **Rush Swarm:** Mina Nv3 rápido → 30+ Cazas Ligeros → abrumas con cantidad
- **Tortuga:** Reactor Nv3 + Blindaje Nv2 + 2 Cruceros + Defensas → esperas contraataque
- **Sniper:** Armamento Nv1 rápido → 3-4 Bombarderos → destruyes el Crucero del rival

---

## Escenas en Phaser 3

El juego se divide en 4 escenas separadas:

```javascript
// Escena 1: SceneMenu
//   - Input para nombre/sala
//   - Firebase: crear/unirse a sala

// Escena 2: ScenePlaneta (los 10 minutos)
//   - Tu planeta con animaciones de extracción
//   - Panel de construcción: edificios, techs, naves
//   - Timer sincronizado con Firebase
//   - Mini-panel del planeta enemigo (solo lectura)

// Escena 3: SceneBatalla (5 minutos)
//   - Canvas dividido: tu flota vs flota enemiga
//   - Naves se mueven con tweens y disparos con partículas
//   - Explosiones con sprite sheets de 8 frames
//   - Cálculo de daño por turnos rápidos (cada 0.5 seg)

// Escena 4: SceneResultado
//   - Ganador/perdedor
//   - Stats: naves destruidas, recursos gastados, tiempo
```

---

## Cómo Funciona Firebase en el Juego

Firebase actúa como pizarra compartida en la nube. Estructura de datos:

```json
{
  "salas": {
    "sala123": {
      "estado": "construccion",
      "timer": 600,
      "jugador1": {
        "metal": 1500,
        "cristal": 300,
        "energia": 2,
        "edificios": { "mina": 2, "cristalizador": 1, "reactor": 1 },
        "tecnologias": { "blindaje": 1 },
        "naves": { "cazaLigero": 12, "crucero": 1 },
        "listo": false
      },
      "jugador2": {
        "metal": 900,
        "cristal": 500,
        "energia": 1,
        "edificios": { "mina": 1, "cristalizador": 2, "reactor": 0 },
        "tecnologias": { "armamento": 1 },
        "naves": { "bombardero": 3, "cazaLigero": 5 },
        "listo": false
      }
    }
  }
}
```

Cada acción del jugador escribe en Firebase → el otro lo ve instantáneamente con `onValue()`.

---

## Assets Visuales: Estado Actual

### ✅ Prompts ya generados para Nano Banana Pro

**Edificios (15 sprites = 5 edificios × 3 niveles):**
- Mina de Metal Nv1, Nv2, Nv3 (glow AZUL, isométrico 45°)
- Cristalizador Nv1, Nv2, Nv3 (glow MORADO, cristales creciendo)
- Reactor Solar Nv1, Nv2, Nv3 (glow AMARILLO, paneles solares)
- Laboratorio Nv1, Nv2, Nv3 (glow CYAN, domo con hologramas)
- Astillero Nv1, Nv2, Nv3 (glow ROJO-NARANJA, hangar con brazos robóticos)

**Animaciones de extracción (3 sprite sheets, 6 frames cada uno):**
- Extracción de Metal (robots excavando, chunks volando)
- Extracción de Cristal (cristales creciendo y siendo absorbidos)
- Extracción de Energía (paneles rotando, arcos eléctricos)

**Naves (5 tipos, cada una con anchor + sprite sheet 4 direcciones):**
- 🛸 Caza Ligero — casco ICE BLUE, motor CYAN
- 🚀 Fragata — casco SILVER/DARK GREY, motor GREEN
- ⚡ Caza Avanzado — casco PURPLE/BLACK, motor MAGENTA
- 🛡️ Crucero — casco DARK RED/IRON GREY, 4 motores ORANGE
- 💣 Bombardero — casco DARK GREY/OLIVE, tubos torpedo

**Efectos de batalla:**
- Explosión grande (8 frames, para cruceros)
- Explosión pequeña (6 frames, para cazas)
- Proyectil torpedo (4 frames)
- Láser del caza (3 frames)

### 📌 Nota sobre el formato de los assets
- Todos se generaron con **fondo verde #00FF00** (no transparente directo)
- En Phaser 3 se elimina el verde con chroma key: `texture.setChromaKey(0x00ff00)`
- Los sprite sheets son horizontales: todos los frames en una sola imagen ancha
- Tamaño por frame: 512×512px para edificios/planetas, 128-256px para naves, 64-256px para efectos

---

## Lo que Falta Hacer (Estado al momento de este documento)

### 1. ✅ COMPLETADO: Diseño del juego
- Árbol de recursos, edificios, tecnologías, naves
- Sistema de counters y estrategias
- Flujo completo de la partida

### 2. ✅ COMPLETADO: Prompts para Nano Banana
- Edificios (todos los niveles + animaciones de extracción)
- Naves (anchor + 4 direcciones + animaciones de acción)
- Efectos de batalla (explosiones, proyectiles)
- El usuario aún NO ha generado los assets — los prompts están listos para usar

### 3. ❌ PENDIENTE: Código base del juego
Esta es la siguiente tarea. Se necesita escribir:

#### index.html
- Carga Phaser 3 desde CDN
- Carga Firebase SDK desde CDN
- Inicia el juego en un canvas 1280×720

#### game.js — Estructura completa:

```
SceneMenu
  ├─ UI para crear/unirse a sala
  ├─ Input de nombre del jugador
  └─ Firebase: escribir/leer sala

ScenePlaneta
  ├─ Fondo espacial animado (parallax)
  ├─ Planeta del jugador con sprite rotando
  ├─ Animaciones de extracción activas
  ├─ Panel UI: recursos actuales (contador animado)
  ├─ Panel edificios: botones con costo y tiempo de construcción
  ├─ Panel tecnologías: árbol con prereqs
  ├─ Panel naves: queue de construcción con barra de progreso
  ├─ Timer countdown (sincronizado con Firebase)
  ├─ Mini-panel enemigo (lectura Firebase, sin interacción)
  └─ Transición automática a SceneBatalla al llegar a 0

SceneBatalla
  ├─ Generación de flotas desde el estado Firebase al terminar construcción
  ├─ Animación de entrada de naves (tween desde lados opuestos)
  ├─ Sistema de combate por rondas (cada 500ms):
  │   ├─ Cada nave ataca según su target (sistema de counters)
  │   ├─ Daño se aplica con reducción por blindaje/escudo
  │   ├─ Naves con HP=0 reproducen animación de explosión y desaparecen
  │   └─ Proyectiles animados entre atacante y objetivo
  └─ Cuando un bando queda sin naves → transición a SceneResultado

SceneResultado
  ├─ Anuncio de ganador (con animación)
  ├─ Stats de la batalla
  └─ Botón para jugar de nuevo
```

#### Funciones Firebase necesarias:
```javascript
crearSala(idSala, nombreJugador)
unirseASala(idSala, nombreJugador)
actualizarRecursos(idSala, jugador, recursos)
construirEdificio(idSala, jugador, edificio, nivel)
fabricarNave(idSala, jugador, tipoNave, cantidad)
escucharCambios(idSala, callback)
sincronizarTimer(idSala)
iniciarBatalla(idSala)
```

### 4. ❌ PENDIENTE: Configuración Firebase
El usuario necesita:
1. Crear proyecto en firebase.google.com (gratis)
2. Activar "Realtime Database"
3. Copiar el objeto de configuración (apiKey, databaseURL, etc.)
4. Pegarlo en el archivo `game.js` en la sección de inicialización

### 5. ❌ PENDIENTE: Publicar en GitHub Pages
1. Crear repositorio en GitHub
2. Subir todos los archivos (index.html, game.js, assets/)
3. Settings → Pages → Source: main branch
4. Compartir URL con el amigo

---

## Perfil del Usuario (contexto para el AI)

- **Ubicación:** Bucaramanga, Colombia
- **Nivel técnico:** Avanzado en IA y creación de contenido, **principiante en desarrollo web**
- **Conoce:** Python, algo de JavaScript básico, GDevelop (no-code)
- **No conoce:** Phaser 3, Firebase, Node.js, npm
- **Necesita:** Código que funcione al pegar y que tenga comentarios claros en español
- **Herramientas de IA disponibles:** Claude, Gemini/Nano Banana, ChatGPT, Perplexity

---

## Instrucciones para el AI que Continúa

1. **Escribe el código completo** de `index.html` y `game.js` desde cero
2. **El código debe funcionar** pegando los archivos en una carpeta local y abriendo `index.html` en Chrome, **sin instalar nada**
3. **Si no hay assets aún**, usa rectángulos de colores con etiquetas de texto como placeholder — el usuario los reemplazará con sus PNGs de Nano Banana después
4. **Comenta el código en español** — el usuario necesita entender qué hace cada sección
5. **Prioriza que funcione** sobre que sea perfecto — puede iterarse después
6. Para el multijugador con Firebase, el usuario necesita que le expliques paso a paso cómo crear el proyecto Firebase y obtener las credenciales
7. El **timer de 10 minutos** debe sincronizarse en Firebase para que ambos jugadores lo vean igual
8. En la **fase de batalla**, si los sprites no están disponibles, usa círculos/triángulos de diferentes colores para representar cada tipo de nave
9. La **economía de recursos** debe ser x10 más rápida que OGame normal para que en 10 min se pueda construir una flota significativa

---

*Documento generado el 29 de marzo de 2026. Proyecto en desarrollo activo.*
