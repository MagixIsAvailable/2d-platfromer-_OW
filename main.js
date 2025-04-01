// ... (Imports: THREE, WebGPU, Rapier, GLTFLoader) ...
import * as THREE from 'three';
import WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
let RAPIER = null;

// ... (Constants: GRAVITY_RAPIER, PLAYER_MOVE_FORCE, etc. - Remove character/physics specifics)

// --- Global Variables ---
let scene, camera, renderer, canvas;
let clock = new THREE.Clock();
let input = { /* ... */ };
let textureLoader, modelLoader;
let infoElement;

// --- Game State Variables ---
let gameConfig = null; // To store loaded config.json
let currentEnvironment = null; // Info about the loaded environment
let player1Data = { mesh: null, body: null, config: null, state: 'idle', animTime: 0 }; // Store player info
let player2Data = { mesh: null, body: null, config: null, state: 'idle', animTime: 0 };

// --- Rapier Specific Globals ---
let rapierWorld = null;
let rapierEventLoop = null;
let platformBodies = []; // Keep track of platform bodies if needed

// --- Initialization Flow ---

function setupGame() {
    infoElement = document.getElementById('info');
    const startButton = document.getElementById('start-button');
    const introScreen = document.getElementById('intro-screen');
    // !!! Add UI elements here later for character/stage selection !!!

    startButton.addEventListener('click', async () => {
        introScreen.style.display = 'none';
        infoElement.textContent = 'Checking WebGPU...';

        if (WebGPU.isAvailable() === false) { /* ... error handling ... */ return; }

        try {
            infoElement.textContent = 'Loading Configuration...';
            await loadConfig(); // <--- Load config.json first

            infoElement.textContent = 'Initializing Graphics...';
            await initGraphics();

            infoElement.textContent = 'Loading Physics Engine...';
            await initPhysics();

            infoElement.textContent = 'Loading Assets...';
            // !!! Choose which assets to load based on config/selection !!!
            const envIndex = 0; // Example: Load the first environment
            const p1CharIndex = 0; // Example: Load the first character for P1
            const p2CharIndex = 1; // Example: Load the second character for P2 (ensure it exists!)
            await loadAssets(envIndex, p1CharIndex, p2CharIndex);

            infoElement.textContent = 'Starting Game Loop...';
            setupInputListeners();
            animate();
            infoElement.style.display = 'none';
        } catch (error) {
            // ... (Error handling) ...
            console.error("Initialization or Loading Failed:", error);
            infoElement.textContent = `Error: ${error.message}. Check console.`;
            if (canvas) canvas.style.visibility = 'hidden';
        }
    });
}

async function loadConfig() {
    try {
        const response = await fetch('config.json'); // Adjust path if needed
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        gameConfig = await response.json();
        console.log("Game configuration loaded:", gameConfig);
    } catch (e) {
        console.error("Failed to load config.json:", e);
        throw e; // Re-throw to stop initialization
    }
}


async function initGraphics() { /* ... (Same as before) ... */ }
async function initPhysics() { /* ... (Same as before) ... */ }

async function loadAssets(environmentIndex, player1CharIndex, player2CharIndex) {
    if (!rapierWorld || !gameConfig) {
        throw new Error("Physics world or game config not initialized.");
    }
    if (environmentIndex >= gameConfig.environments.length ||
        player1CharIndex >= gameConfig.characters.length ||
        player2CharIndex >= gameConfig.characters.length) {
        throw new Error("Selected environment or character index out of bounds.");
    }

    textureLoader = new THREE.TextureLoader();
    modelLoader = new GLTFLoader();

    // --- Load Environment ---
    currentEnvironment = gameConfig.environments[environmentIndex];
    console.log(`Loading Environment: ${currentEnvironment.name}`);

    // Load Background
    const backgroundTexture = await textureLoader.loadAsync(currentEnvironment.background);
    createBackground(backgroundTexture);

    // Create Platforms (Visuals + Physics) from config
    createPlatformsWithPhysics(currentEnvironment.platforms);

    // --- Load Characters ---
    const char1Config = gameConfig.characters[player1CharIndex];
    const char2Config = gameConfig.characters[player2CharIndex];

    console.log(`Loading Player 1: ${char1Config.name}`);
    player1Data = await createPlayerWithPhysics(char1Config, new THREE.Vector3(-4, 2, 0));

    console.log(`Loading Player 2: ${char2Config.name}`);
    player2Data = await createPlayerWithPhysics(char2Config, new THREE.Vector3(4, 2, 0));

    // Ensure meshes are added to the scene
     if (player1Data.mesh) scene.add(player1Data.mesh);
     if (player2Data.mesh) scene.add(player2Data.mesh);

}


// --- Game Element Creation (using config data) ---

function createBackground(texture) { /* ... (Same as before) ... */ }

function createPlatformsWithPhysics(platformData) {
    platformBodies = []; // Clear previous platforms if any
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });

    platformData.forEach(pData => {
        const pos = new THREE.Vector3().fromArray(pData.pos);
        const size = new THREE.Vector3().fromArray(pData.size);

        // Three.js Mesh
        const meshGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
        const mesh = new THREE.Mesh(meshGeo, platformMaterial);
        mesh.position.copy(pos);
        mesh.receiveShadow = true;
        scene.add(mesh);

        // Rapier RigidBody (Fixed)
        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
        const body = rapierWorld.createRigidBody(bodyDesc);

        // Rapier Collider (Cuboid)
        const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
        rapierWorld.createCollider(colliderDesc, body);

        platformBodies.push({ mesh, body });
    });
}

async function createPlayerWithPhysics(characterConfig, startPos) {
    let playerMesh;
    let body;

    // --- Rapier RigidBody Setup (Common for both types) ---
    const physicsConfig = characterConfig.physics;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(startPos.x, startPos.y, startPos.z)
        .lockRotations()
        .setLinearDamping(1.0) // Example damping
        .setCcdEnabled(true);
    body = rapierWorld.createRigidBody(bodyDesc);

    // --- Rapier Collider Setup (Common) ---
    const colliderDesc = RAPIER.ColliderDesc.capsuleY(physicsConfig.height / 2, physicsConfig.radius)
        .setFriction(0.7)
        .setRestitution(0.0);
    const collider = rapierWorld.createCollider(colliderDesc, body); // Assign to body


    // --- Create Visual Mesh (Conditional) ---
    if (characterConfig.type === 'model') {
        const gltf = await modelLoader.loadAsync(characterConfig.asset);
        playerMesh = gltf.scene;
        playerMesh.scale.setScalar(characterConfig.scale || 1.0);
        playerMesh.traverse(node => { if (node.isMesh) node.castShadow = true; });
        // Add animation mixer setup here later if needed

    } else if (characterConfig.type === 'spritesheet') {
        const spriteConfig = characterConfig.spriteData;
        const map = await textureLoader.loadAsync(characterConfig.asset);

        // Calculate sprite sheet properties
        map.magFilter = THREE.NearestFilter; // Pixelated look
        map.minFilter = THREE.NearestFilter;
        const framesX = Math.floor(map.image.width / spriteConfig.frameWidth);
        const framesY = Math.floor(map.image.height / spriteConfig.frameHeight);
        map.repeat.set(1 / framesX, 1 / framesY); // Set repeat to show only one frame

        const spriteMaterial = new THREE.MeshBasicMaterial({
            map: map,
            transparent: true,
            side: THREE.DoubleSide, // Render both sides
             alphaTest: 0.1 // Adjust if transparent edges cause issues
        });

        // Adjust plane size based on frame aspect ratio and scale
        const aspect = spriteConfig.frameWidth / spriteConfig.frameHeight;
        const planeHeight = physicsConfig.height * (spriteConfig.scale || 1.0) * 0.8; // Approximate visual height based on collider
        const planeWidth = planeHeight * aspect;

        const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
        playerMesh = new THREE.Mesh(planeGeometry, spriteMaterial);

        // Store sprite-specific data for animation
        playerMesh.userData.sprite = {
            framesX: framesX,
            framesY: framesY,
            frameWidth: spriteConfig.frameWidth,
            frameHeight: spriteConfig.frameHeight,
            currentFrame: 0,
        };

    } else {
        throw new Error(`Unsupported character type: ${characterConfig.type}`);
    }

    // --- Link Mesh and Body ---
    playerMesh.userData.config = characterConfig; // Store character config
    playerMesh.userData.physicsBody = body;
    playerMesh.userData.state = 'idle'; // Initial state
    playerMesh.userData.animTime = 0;   // Animation timer
    playerMesh.userData.health = 100;   // Example health
    body.userData = { mesh: playerMesh };

    // Don't add to scene here, done in loadAssets
    return { mesh: playerMesh, body: body, config: characterConfig, state: 'idle', animTime: 0 };
}


// --- Input Handling (setupInputListeners - Same as before) ---
function setupInputListeners() { /* ... */ }

// --- Game Loop & Physics Step ---
function animate() {
    renderer.setAnimationLoop(updateAndRender);
}

function updateAndRender() {
    if (!renderer || !scene || !camera || !rapierWorld || !player1Data.body || !player2Data.body) return;

    const deltaTime = Math.min(clock.getDelta(), 0.05);

    // 1. Process Input and Apply Forces/Velocities
    updatePlayerPhysics(player1Data, input.p1Left, input.p1Right, input.p1Jump, input.p1Attack, deltaTime);
    updatePlayerPhysics(player2Data, input.p2Left, input.p2Right, input.p2Jump, input.p2Attack, deltaTime);
    input.p1Jump = false; // Reset jump request
    input.p2Jump = false;

    // 2. Step Physics World
    rapierWorld.step(rapierEventLoop);

    // 3. Synchronize Three.js Meshes
    syncPhysics();

    // 4. Update Animations (Spritesheets / Models)
    updateAnimations(deltaTime);

    // 5. Handle Game Logic (Attacks, State Changes)
    handleAttacks(); // Needs refinement for sprites/models
    updatePlayerStates(); // Update visual states

    // 6. Keep players facing each other
    updatePlayerFacing();

    // 7. Render Scene
    renderer.render(scene, camera);
}

// --- Physics Update Logic ---
function isPlayerGrounded(playerBody, physicsConfig) { // Pass physicsConfig
     if (!playerBody || !rapierWorld || !physicsConfig) return false;

     const bodyPos = playerBody.translation();
     // Use configured capsule dimensions
     const capsuleBottomOffset = physicsConfig.height / 2; // Center to bottom edge
     const rayStartOffset = capsuleBottomOffset - physicsConfig.radius * 0.5; // Start ray inside bottom sphere
     const rayLength = physicsConfig.radius * 0.5 + 0.1; // Ray just reaches slightly past bottom sphere

     const rayOrigin = { x: bodyPos.x, y: bodyPos.y - rayStartOffset, z: bodyPos.z };
     const rayDirection = { x: 0, y: -1, z: 0 };
     const ray = new RAPIER.Ray(rayOrigin, rayDirection);
     const maxDistance = rayLength;

     const hit = rapierWorld.castRay(ray, maxDistance, true, null, null, playerBody); // Exclude self

     return hit !== null; // Grounded if ray hit anything
 }


function updatePlayerPhysics(playerData, left, right, jumpRequested, attack, dt) {
    if (!playerData.body || !playerData.config) return;

    const playerBody = playerData.body;
    const config = playerData.config;
    const currentVel = playerBody.linvel();
    const physicsConfig = config.physics; // Get physics dims from config

    // Movement constants (could be moved to config too)
    const moveVel = 7.0;
    let targetVelX = 0;
    if (left) targetVelX -= moveVel;
    if (right) targetVelX += moveVel;
    playerBody.setLinvel({ x: targetVelX, y: currentVel.y, z: 0 }, true);

    // Jumping
    const grounded = isPlayerGrounded(playerBody, physicsConfig); // Pass config
    if (jumpRequested && grounded) {
        playerBody.applyImpulse({ x: 0, y: 15.0, z: 0 }, true); // Example jump impulse
    }
}

// --- Synchronization & Animation ---

function syncPhysics() {
    [player1Data, player2Data].forEach(pData => {
        if (pData.mesh && pData.body) {
            const pos = pData.body.translation();
            pData.mesh.position.set(pos.x, pos.y, pos.z);
            // Adjust visual height slightly if capsule base doesn't match visual base
             pData.mesh.position.y -= (pData.config.physics.height / 2); // Lower mesh to align base
             pData.mesh.position.y += (pData.mesh.geometry.parameters.height / 2); // Raise by half plane height if sprite


            // Rotation sync only needed if not locked or for visual cues
        }
    });
}

function updateAnimations(dt) {
    updateSpriteAnimation(player1Data, dt);
    updateSpriteAnimation(player2Data, dt);
    // Add model animation updates here later if using models with animations
}

function updateSpriteAnimation(playerData, dt) {
    const mesh = playerData.mesh;
    if (!mesh || !mesh.userData.sprite || !playerData.config.spriteData) return; // Only run for sprites

    const state = playerData.state; // Use the centrally stored state
    const spriteInfo = mesh.userData.sprite;
    const anims = playerData.config.spriteData.animations;

    if (!anims[state]) {
        console.warn(`Animation state "${state}" not found for ${playerData.config.id}`);
        return; // No animation defined for this state
    }

    const anim = anims[state];
    const frameCount = anim.frames.length;
    const duration = frameCount / anim.fps;
    const loop = anim.loop !== false; // Default to true

    playerData.animTime += dt; // Increment animation timer

    let frameIndex;
    if (loop) {
        frameIndex = Math.floor((playerData.animTime % duration) * anim.fps);
    } else {
        frameIndex = Math.min(Math.floor(playerData.animTime * anim.fps), frameCount - 1);
        // Optionally transition state when non-looping animation finishes
         if (playerData.animTime >= duration /* && state === 'attack' etc */) {
            // playerData.state = 'idle'; // Example transition back to idle
            // playerData.animTime = 0;
         }
    }


    const spriteFrame = anim.frames[frameIndex];

    // Calculate texture offset
    const frameX = spriteFrame % spriteInfo.framesX;
    const frameY = Math.floor(spriteFrame / spriteInfo.framesX);

    mesh.material.map.offset.x = frameX / spriteInfo.framesX;
    mesh.material.map.offset.y = 1.0 - ((frameY + 1) / spriteInfo.framesY); // Y is flipped in texture coords

    // console.log(`State: ${state}, Frame: ${spriteFrame}, Offset: ${mesh.material.map.offset.x.toFixed(2)}, ${mesh.material.map.offset.y.toFixed(2)}`);

}


// --- Game Logic Updates ---

function handleAttacks() {
    // Basic Hit Detection - NEEDS REFINEMENT FOR HITBOXES
    if (input.p1Attack && player1Data.state !== 'attacking' && player1Data.state !== 'hit_stun') {
        player1Data.state = 'attacking';
        player1Data.animTime = 0; // Reset anim timer for attack
        performAttack(player1Data, player2Data);
        // Attack state might reset automatically if animation is non-looping (see updateSpriteAnimation)
         // Or reset with a timer:
         setTimeout(() => { if (player1Data.state === 'attacking') player1Data.state = 'idle'; }, 500); // Example delay
    }
     if (input.p2Attack && player2Data.state !== 'attacking' && player2Data.state !== 'hit_stun') {
        player2Data.state = 'attacking';
        player2Data.animTime = 0;
        performAttack(player2Data, player1Data);
        setTimeout(() => { if (player2Data.state === 'attacking') player2Data.state = 'idle'; }, 500);
    }
}


function performAttack(attackerData, targetData) {
    // Use Rapier shape casting or sensor colliders for real hit detection.
    // This is still a placeholder proximity check.
     if (!attackerData.body || !targetData.body || !attackerData.mesh || !targetData.mesh) return;

     const attackerPos = attackerData.body.translation();
     const targetPos = targetData.body.translation();
     const distance = Math.hypot(targetPos.x - attackerPos.x, targetPos.y - attackerPos.y);

     const attackRange = attackerData.config.physics.radius * 2 + 0.8; // Example

     const facingRight = attackerData.mesh.rotation.y < Math.PI / 2; // Basic facing check
     const targetIsRight = targetPos.x > attackerPos.x;

     if (distance < attackRange && ((facingRight && targetIsRight) || (!facingRight && !targetIsRight))) {
         console.log(`${attackerData.config.name} HITS ${targetData.config.name}!`);
         targetData.mesh.userData.health -= 10;

         // Apply knockback
         const knockbackStrength = 5.0;
         const direction = Math.sign(targetPos.x - attackerPos.x);
         targetData.body.applyImpulse({ x: direction * knockbackStrength, y: 2.0, z: 0 }, true);

         // Set target state
         targetData.state = 'hit_stun';
         targetData.animTime = 0; // Reset target anim timer
         setTimeout(() => { if (targetData.state === 'hit_stun') targetData.state = 'idle'; }, 300); // Hit stun duration


         console.log(`${targetData.config.name} Health: ${targetData.mesh.userData.health}`);
         if (targetData.mesh.userData.health <= 0) {
             console.log("K.O.!");
             targetData.state = 'knocked_out'; // Add KO animation state
         }
     }
}

function updatePlayerStates() {
    // Update player state based on physics, handle transitions
    [player1Data, player2Data].forEach(pData => {
        if (!pData.body || !pData.config || !pData.mesh) return;

        // Don't override attack or hit states immediately
        if (pData.state === 'attacking' || pData.state === 'hit_stun' || pData.state === 'knocked_out') {
             // Allow these states to persist based on animation/timers
             // Reset animTime if state *changes* to this
            return;
        }

        const grounded = isPlayerGrounded(pData.body, pData.config.physics);
        const velocity = pData.body.linvel();
        let newState = pData.state; // Start with current state

        if (!grounded) {
            newState = velocity.y > 0.1 ? 'jump' : 'fall'; // Use jump/fall anims
        } else if (Math.abs(velocity.x) > 0.1) {
            newState = 'walk';
        } else {
            newState = 'idle';
        }

        if (pData.state !== newState) {
            // console.log(`Player ${pData.config.id} state: ${pData.state} -> ${newState}`);
            pData.state = newState;
            pData.animTime = 0; // Reset animation timer on state change
        }
    });
}

function updatePlayerFacing() {
     if (!player1Data.mesh || !player2Data.mesh) return;
     if (player1Data.mesh.position.x > player2Data.mesh.position.x) {
         player1Data.mesh.rotation.y = Math.PI; // Face left
         player2Data.mesh.rotation.y = 0;      // Face right
     } else {
         player1Data.mesh.rotation.y = 0;      // Face right
         player2Data.mesh.rotation.y = Math.PI; // Face left
     }
 }


// --- Resize Handling ---
window.addEventListener('resize', () => { /* ... (Same as before) ... */ });

// --- Start ---
setupGame();