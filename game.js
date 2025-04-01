import * as THREE from 'three';
import WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Import Rapier dynamically
let RAPIER = null; // Will hold the loaded Rapier module

// --- Configuration ---
const GRAVITY_RAPIER = { x: 0.0, y: -9.81 * 2, z: 0.0 }; // Rapier uses different scale sometimes
const PLAYER_MOVE_FORCE = 150.0; // Force for movement (adjust)
const PLAYER_JUMP_IMPULSE = 15.0;  // Impulse for jumping (adjust)
const PLAYER_MAX_VELOCITY_X = 7.0;
const PLAYER_DAMPING = 1.0; // Linear damping to prevent sliding forever
const GROUND_RAY_LENGTH = 0.6; // Ray length for ground check (relative to capsule bottom)
const GROUND_RAY_OFFSET = 0.45; // How far down inside the capsule the ray starts

// Adjust these based on your loaded models' actual size!
// These now primarily define the *collider* size.
const PLAYER_CAPSULE_HEIGHT = 1.8; // Total height of the capsule
const PLAYER_CAPSULE_RADIUS = 0.4;
const PLAYER_MODEL_SCALE = 1.5; // Visual scale

// --- Global Variables ---
let scene, camera, renderer, canvas;
let player1Mesh, player2Mesh; // Renamed to distinguish Three.js mesh from physics body
let player1Body, player2Body; // Rapier RigidBody objects
let platforms = []; // Will store { mesh: THREE.Mesh, body: RAPIER.RigidBody }
let clock = new THREE.Clock();
let input = {
    p1Left: false, p1Right: false, p1Jump: false, p1Attack: false,
    p2Left: false, p2Right: false, p2Jump: false, p2Attack: false
};
// Velocities are now handled by Rapier

let textureLoader, modelLoader;
let infoElement;

// --- Rapier Specific Globals ---
let rapierWorld = null;
let rapierEventLoop = null; // For handling collision events later
let physicsInterval; // To store the physics step interval if needed

// --- Initialization Flow ---

function setupGame() {
    infoElement = document.getElementById('info');
    const startButton = document.getElementById('start-button');
    const introScreen = document.getElementById('intro-screen');
    canvas = document.querySelector('canvas');

    startButton.addEventListener('click', async () => {
        introScreen.style.display = 'none';
        infoElement.textContent = 'Checking WebGPU...';

        if (WebGPU.isAvailable() === false) {
            // ... (WebGPU check) ...
            infoElement.textContent = 'WebGPU is not available on this browser.';
            document.body.appendChild(WebGPU.getErrorMessage());
            return;
        }

        try {
            infoElement.textContent = 'Initializing Graphics...';
            await initGraphics();

            infoElement.textContent = 'Loading Physics Engine...';
            await initPhysics(); // <--- Load and initialize Rapier

            infoElement.textContent = 'Loading Assets...';
            await loadAssets(); // Load models, textures, AND create physics bodies

            infoElement.textContent = 'Starting Game Loop...';
            setupInputListeners();
            animate();
            infoElement.style.display = 'none';
        } catch (error) {
            console.error("Initialization or Loading Failed:", error);
            infoElement.textContent = `Error: ${error.message}. Check console.`;
            if (canvas) canvas.style.visibility = 'hidden';
        }
    });
}

async function initGraphics() {
    // ... (Scene, Camera, Renderer, Lighting setup as before) ...
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333344);
    scene.fog = new THREE.Fog(0x333344, 15, 50);

    // Camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 4, 14); // Adjusted camera slightly
    camera.lookAt(0, 1.5, 0);

    // Renderer (WebGPU)
    renderer = new WebGPURenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);
    canvas = renderer.domElement;
    canvas.style.visibility = 'visible';
    await renderer.init();
    console.log("WebGPU Renderer Initialized Successfully");

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xcccccc, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    // renderer.shadowMap.enabled = true; // Enable if desired
}

async function initPhysics() {
    // Dynamically import Rapier
    RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init(); // Initialize WASM module if needed by the compat version

    // Create the Physics World
    rapierWorld = new RAPIER.World(GRAVITY_RAPIER);
    rapierEventLoop = new RAPIER.EventQueue(true); // Enable collision event capture if needed later

    console.log("Rapier3D Initialized Successfully");
}

async function loadAssets() {
    if (!rapierWorld) {
        throw new Error("Physics world not initialized before loading assets.");
    }
    textureLoader = new THREE.TextureLoader();
    modelLoader = new GLTFLoader();

    // Load Background
    const backgroundTexture = await textureLoader.loadAsync('assets/background.jpg');
    createBackground(backgroundTexture); // No physics for background

    // Create Platforms (Visuals + Physics)
    createPlatformsWithPhysics();

    // Load Player Models (Visuals + Physics)
    const [p1Gltf, p2Gltf] = await Promise.all([
        modelLoader.loadAsync('assets/player1.glb'),
        modelLoader.loadAsync('assets/player2.glb')
    ]);
    createPlayersWithPhysics(p1Gltf, p2Gltf);
}


// --- Game Element Creation (with Physics) ---

function createBackground(texture) {
     // ... (Same as before, no physics needed) ...
    const aspect = window.innerWidth / window.innerHeight;
    const height = 15;
    const width = height * aspect;
    const backgroundGeo = new THREE.PlaneGeometry(width, height);
    const backgroundMat = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false });
    const backgroundMesh = new THREE.Mesh(backgroundGeo, backgroundMat);
    backgroundMesh.position.set(0, height / 2 - 1, -10);
    backgroundMesh.renderOrder = -1;
    scene.add(backgroundMesh);
}

function createPlatformsWithPhysics() {
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });

    // Helper to create both Three.js mesh and Rapier body/collider
    const createPlatform = (pos, size) => {
        // Three.js Mesh
        const meshGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
        const mesh = new THREE.Mesh(meshGeo, platformMaterial);
        mesh.position.copy(pos);
        mesh.receiveShadow = true;
        scene.add(mesh);

        // Rapier RigidBody (Fixed)
        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
        const body = rapierWorld.createRigidBody(bodyDesc);

        // Rapier Collider (Cuboid shape matches BoxGeometry)
        const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
        rapierWorld.createCollider(colliderDesc, body);

        platforms.push({ mesh, body }); // Store both
    };

    // Ground platform
    createPlatform(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(30, 1, 5));

    // Floating platform
    createPlatform(new THREE.Vector3(-6, 4, 0), new THREE.Vector3(6, 0.5, 3));

     // Add more platforms here using createPlatform()
}

function createPlayersWithPhysics(p1Gltf, p2Gltf) {
    // Helper to create player (mesh + physics)
    const createPlayer = (gltf, startPos, isPlayer1) => {
        // --- Three.js Mesh Setup ---
        const mesh = gltf.scene;
        mesh.scale.set(PLAYER_MODEL_SCALE, PLAYER_MODEL_SCALE, PLAYER_MODEL_SCALE);
        // Initial visual position - Rapier will position it precisely
        mesh.position.copy(startPos);
        scene.add(mesh);
        mesh.traverse(node => { if (node.isMesh) node.castShadow = true; });

        // --- Rapier RigidBody Setup ---
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(startPos.x, startPos.y, startPos.z)
            .lockRotations() // Prevent capsule from falling over
            .setLinearDamping(PLAYER_DAMPING) // Apply damping
            .setCcdEnabled(true); // Enable Continuous Collision Detection (helps prevent tunneling)

        const body = rapierWorld.createRigidBody(bodyDesc);

        // --- Rapier Collider Setup (Capsule) ---
        // Capsule height is along Y axis. Offset start/end points if needed.
        const colliderDesc = RAPIER.ColliderDesc.capsuleY(PLAYER_CAPSULE_HEIGHT / 2, PLAYER_CAPSULE_RADIUS)
             .setFriction(0.7) // Adjust friction
             .setRestitution(0.0); // Adjust bounciness (usually low for characters)

        const collider = rapierWorld.createCollider(colliderDesc, body);

        // --- Link Mesh and Body ---
        mesh.userData.physicsBody = body; // Store Rapier body on Three mesh
        body.userData = { mesh: mesh };   // Store Three mesh on Rapier body (optional, but can be useful)

        // Store references globally
        if (isPlayer1) {
            player1Mesh = mesh;
            player1Body = body;
        } else {
            player2Mesh = mesh;
            player2Body = body;
        }
    };

    // Create Player 1
    createPlayer(p1Gltf, new THREE.Vector3(-4, 2, 0), true); // Start slightly higher

    // Create Player 2
    createPlayer(p2Gltf, new THREE.Vector3(4, 2, 0), false);
}


// --- Input Handling (Unchanged for now, jump logic moves to physics update) ---
function setupInputListeners() {
    // (Keep the keydown/keyup listeners from the previous example)
     window.addEventListener('keydown', (event) => {
        // Allow jump input regardless of ground state here, check ground in physics update
        switch (event.code) {
            case 'KeyA': input.p1Left = true; break;
            case 'KeyD': input.p1Right = true; break;
            case 'KeyW': input.p1Jump = true; break; // Set flag, check ground later
            case 'KeyF': input.p1Attack = true; break;
            case 'ArrowLeft': input.p2Left = true; break;
            case 'ArrowRight': input.p2Right = true; break;
            case 'ArrowUp': input.p2Jump = true; // Set flag, check ground later
            case 'NumpadEnter': case 'Enter': input.p2Attack = true; break;
        }
    });
     window.addEventListener('keyup', (event) => {
        switch (event.code) {
            case 'KeyA': input.p1Left = false; break;
            case 'KeyD': input.p1Right = false; break;
            case 'KeyW': input.p1Jump = false; break; // Clear jump *request* flag
            case 'KeyF': input.p1Attack = false; break;
            case 'ArrowLeft': input.p2Left = false; break;
            case 'ArrowRight': input.p2Right = false; break;
            case 'ArrowUp': input.p2Jump = false; // Clear jump *request* flag
            case 'NumpadEnter': case 'Enter': input.p2Attack = false; break;
        }
    });
}

// --- Game Loop & Physics Step ---
function animate() {
    renderer.setAnimationLoop(updateAndRender);
}

function updateAndRender() {
    if (!renderer || !scene || !camera || !rapierWorld || !player1Body || !player2Body) return;

    const deltaTime = Math.min(clock.getDelta(), 0.05); // Clamp delta time

    // 1. Process Input and Apply Forces/Velocities to Physics Bodies
    updatePlayerPhysics(player1Body, input.p1Left, input.p1Right, input.p1Jump, input.p1Attack, deltaTime);
    updatePlayerPhysics(player2Body, input.p2Left, input.p2Right, input.p2Jump, input.p2Attack, deltaTime);

    // Reset one-shot inputs (like jump request) after processing
    input.p1Jump = false;
    input.p2Jump = false;

    // 2. Step the Physics World
    rapierWorld.step(rapierEventLoop); // Step simulation forward

    // 3. Process Collision Events (Optional for now)
    // rapierEventLoop.drainCollisionEvents((handle1, handle2, started) => { /* ... */ });

    // 4. Synchronize Three.js Meshes with Physics Bodies
    syncPhysics();

    // 5. Handle Game Logic (Attacks, State Changes based on physics/input)
    handleAttacks();
    updatePlayerStates(); // Update visual states like idle/walking/jumping

    // 6. Keep players facing each other
    updatePlayerFacing();

    // 7. Render Three.js Scene
    renderer.render(scene, camera);
}

// --- Physics Update Logic ---

function isPlayerGrounded(playerBody) {
    if (!playerBody || !rapierWorld) return false;

    const bodyPos = playerBody.translation();
    const capsuleOffset = PLAYER_CAPSULE_HEIGHT / 2 + PLAYER_CAPSULE_RADIUS; // Approx bottom of capsule

    // Ray origin slightly below the center, inside the capsule bottom half
    const rayOrigin = { x: bodyPos.x, y: bodyPos.y - GROUND_RAY_OFFSET, z: bodyPos.z };
    // Ray direction straight down
    const rayDirection = { x: 0, y: -1, z: 0 };
    const ray = new RAPIER.Ray(rayOrigin, rayDirection);
    const maxDistance = PLAYER_CAPSULE_RADIUS + GROUND_RAY_LENGTH - GROUND_RAY_OFFSET; // Max distance from ray origin

    // Perform the raycast
    // `true` means exclude sensor colliders, `null` means no specific collider filter needed here
    const hit = rapierWorld.castRay(ray, maxDistance, true, null, null, playerBody); // Exclude self

    if (hit) {
        // Check distance (toi is "time of impact", essentially distance here)
        const hitDistance = hit.toi;
        // console.log("Ground check hit:", hitDistance.toFixed(3));
        // Allow a small tolerance - grounded if hit distance is very small
        return hitDistance < maxDistance + 0.05; // Small buffer
    }
    // console.log("Ground check miss");
    return false;
}


function updatePlayerPhysics(playerBody, left, right, jumpRequested, attack, dt) {
    if (!playerBody) return;

    const currentVel = playerBody.linvel(); // Get current linear velocity
    let targetVelX = 0;

    // Calculate target horizontal velocity based on input
    if (left) targetVelX -= PLAYER_MAX_VELOCITY_X;
    if (right) targetVelX += PLAYER_MAX_VELOCITY_X;

    // Apply horizontal velocity change (more direct control for platformers)
     playerBody.setLinvel({ x: targetVelX, y: currentVel.y, z: 0 }, true); // z=0 for 2.5D

    // Alternative: Apply force (less direct control, more slippery feel)
    // let forceX = 0;
    // if (left) forceX -= PLAYER_MOVE_FORCE;
    // if (right) forceX += PLAYER_MOVE_FORCE;
    // playerBody.applyImpulse({ x: forceX * dt, y: 0, z: 0 }, true);


    // Jumping
    const grounded = isPlayerGrounded(playerBody);
    if (jumpRequested && grounded) {
        // Apply upward impulse only if grounded
        playerBody.applyImpulse({ x: 0, y: PLAYER_JUMP_IMPULSE, z: 0 }, true);
    }

     // Limit horizontal speed if using forces or impulses lead to exceeding max speed
    // if (Math.abs(currentVel.x) > PLAYER_MAX_VELOCITY_X) {
    //     playerBody.setLinvel({ x: Math.sign(currentVel.x) * PLAYER_MAX_VELOCITY_X, y: currentVel.y, z: 0 }, true);
    // }
}

// --- Synchronization Logic ---

function syncPhysics() {
    // Sync Player 1
    if (player1Mesh && player1Body) {
        const pos = player1Body.translation();
        const rot = player1Body.rotation(); // This is a quaternion
        player1Mesh.position.set(pos.x, pos.y, pos.z);
        // Keep visual rotation locked if physics rotation is locked (or sync if needed)
        // player1Mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w); // Only if you allow physics rotation
    }

    // Sync Player 2
    if (player2Mesh && player2Body) {
        const pos = player2Body.translation();
        const rot = player2Body.rotation();
        player2Mesh.position.set(pos.x, pos.y, pos.z);
        // player2Mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }

    // Sync any other dynamic objects here if necessary
}

// --- Game Logic Updates ---

function handleAttacks() {
    // Basic Hit Detection Placeholder - Needs improvement (proper hitboxes)
    if (input.p1Attack /* && player1 state allows attack */) {
        performAttack(player1Body, player2Body);
        // Set player 1 state to attacking (prevent spamming)
        // Reset attack input flag if needed: input.p1Attack = false;
    }
    if (input.p2Attack /* && player2 state allows attack */) {
        performAttack(player2Body, player1Body);
        // Set player 2 state to attacking
        // Reset attack input flag if needed: input.p2Attack = false;
    }
}

function performAttack(attackerBody, targetBody) {
     if (!attackerBody || !targetBody || !attackerBody.userData?.mesh || !targetBody.userData?.mesh) return;

     const attackerMesh = attackerBody.userData.mesh;
     const targetMesh = targetBody.userData.mesh; // Access mesh via userData

    // Extremely basic proximity/facing check - Replace with Rapier shape casting or collision events!
    const attackerPos = attackerBody.translation();
    const targetPos = targetBody.translation();
    const distanceVec = { x: targetPos.x - attackerPos.x, y: targetPos.y - attackerPos.y, z: 0 };
    const distance = Math.sqrt(distanceVec.x * distanceVec.x + distanceVec.y * distanceVec.y);

    const attackRange = PLAYER_CAPSULE_RADIUS * 2 + 0.8; // Example range based on capsule size

    // Check facing direction (based on visual mesh rotation)
    const facingRight = attackerMesh.rotation.y < Math.PI / 2 && attackerMesh.rotation.y > -Math.PI / 2; // Approx
    const targetIsRight = distanceVec.x > 0;

    if (distance < attackRange && ((facingRight && targetIsRight) || (!facingRight && !targetIsRight))) {
        console.log("HIT (Physics Based Placeholder)!");
        // target.userData.health -= 10; // Need to manage health state

        // Apply knockback impulse via Rapier
        const knockbackStrength = 5.0;
        const knockbackImpulse = {
            x: Math.sign(distanceVec.x) * knockbackStrength,
            y: 1.5, // Small upward pop
            z: 0
        };
        targetBody.applyImpulse(knockbackImpulse, true);

        // Add hit stun state etc.
        console.log("Target Health:", targetMesh.userData.health); // Assuming health is stored on mesh userData still
        if (targetMesh.userData.health <= 0) console.log("K.O.!");

    } else {
        // console.log("Attack Missed");
    }
}


function updatePlayerStates() {
    // Update visual states based on physics (simplified)
    const updateState = (playerBody, playerMesh) => {
        if (!playerBody || !playerMesh) return;
        // Example: Check if attacking state is active first
        // if (playerMesh.userData.state === 'attacking' || playerMesh.userData.state === 'hit_stun') return;

        const grounded = isPlayerGrounded(playerBody);
        const velocity = playerBody.linvel();

        let newState = 'idle';
        if (!grounded) {
            newState = velocity.y > 0 ? 'jumping' : 'falling';
        } else if (Math.abs(velocity.x) > 0.1) {
            newState = 'walking';
        }

        if (playerMesh.userData.state !== newState) {
             playerMesh.userData.state = newState;
             // console.log(`Player ${playerMesh === player1Mesh ? 1 : 2} State: ${newState}`);
             // Trigger animations here based on newState
             // playAnimation(playerMesh, newState);
        }
    };

    updateState(player1Body, player1Mesh);
    updateState(player2Body, player2Mesh);
}


function updatePlayerFacing() {
    if (!player1Mesh || !player2Mesh) return;
    // Keep visual meshes facing each other
    if (player1Mesh.position.x > player2Mesh.position.x) {
        player1Mesh.rotation.y = Math.PI; // Face left
        player2Mesh.rotation.y = 0;      // Face right
    } else {
        player1Mesh.rotation.y = 0;      // Face right
        player2Mesh.rotation.y = Math.PI; // Face left
    }
}


// --- Resize Handling (Unchanged) ---
window.addEventListener('resize', () => {
     // ... (resize logic as before) ...
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}, false);

// --- Start the application ---
setupGame();