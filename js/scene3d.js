/* ============================================================
 * scene3d.js · 3D 场景模块（Three.js r128，非模块版）
 * 户型装修设计 · 净室实现（原创代码）
 * 灵感致敬 wy51ai/floorplan-3d（该仓库无许可证，未使用其代码）
 *
 * 对外接口（window.Floor3D）：
 *   enter(canvas, plan, FURN_BY_ID)  进入 3D（构建场景）
 *   sync(plan)                       方案变化后重建
 *   leave()                          离开 3D（停止渲染）
 *   resize()  fit()  screenshot()
 *   setSun(deg 0-180)  setNight(b)  setSection(b)
 *   setWalk(b)  exitWalk()  focusRoom(i)
 *
 * 坐标约定：2D 平面 (x, y) → 3D (x, z)，高度为 y（mm）
 * ============================================================ */

(function () {
    'use strict';

    var renderer = null, scene = null, camera = null, controls = null;
    var canvas = null, plan = null, FURN = null;
    var raf = null;
    var wallGroup = null, furnGroup = null, floorGroup = null, lightGroup = null;
    var sun = null, ambient = null, roomLights = [];
    var WALL_H = 2800, WALL_H_SECTION = 1300;
    var curSection = false, curNight = false;
    var walk = false, yaw = 0, pitch = 0;
    var keys = {};
    var joy = null;                                   // 触屏摇杆 {ox,oy,dx,dy}
    var look = null;                                  // 触屏视角拖动 {lx,ly}
    var flyT = null;                                  // 房间飞行动画

    var MATS_INDEX = {                                /* 与 index.html 的 MATS 颜色一致 */
        wood: 0xb58a5a, tile: 0xd9d9d4, marble: 0xe8e6e0,
        terrazzo: 0xd7cfc2, carpet: 0xc9b8a6
    };

    /* ================= 材质缓存 ================= */
    function mat(color, rough, metal) {
        return new THREE.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.85 : rough, metalness: metal || 0 });
    }
    var M = {
        wall: null, wallB: null, glass: null,
        wood: null, dark: null, metal: null, white: null, fabric: null, green: null
    };
    function initMats() {
        M.wall = mat(0xe3e7ee); M.wallB = mat(0xcfd6e2);
        M.glass = new THREE.MeshStandardMaterial({ color: 0xaad8f0, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35 });
        M.wood = mat(0xa97e52); M.dark = mat(0x30363f);
        M.metal = mat(0xc8ced6, 0.35, 0.6); M.white = mat(0xf2f2f0);
        M.fabric = mat(0x7a8aa8, 0.95); M.green = mat(0x4e8f4e, 0.95);
    }

    /* ================= 基础工具 ================= */
    function box(w, h, d, material, x, y, z, cast) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
        m.position.set(x || 0, y || 0, z || 0);
        if (cast !== false) { m.castShadow = true; m.receiveShadow = true; }
        return m;
    }
    function cyl(rt, rb, h, material, x, y, z, seg) {
        var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 16), material);
        m.position.set(x || 0, y || 0, z || 0);
        m.castShadow = true; m.receiveShadow = true;
        return m;
    }

    /* ================= 墙体（含窗户玻璃/门洞上方的过梁） ================= */
    function buildWalls(group) {
        var H = curSection ? WALL_H_SECTION : WALL_H;
        plan.walls.forEach(function (w) {
            var horizontal = Math.abs(w.y2 - w.y1) < 1;
            var len = horizontal ? Math.abs(w.x2 - w.x1) : Math.abs(w.y2 - w.y1);
            var dirSign = 1;
            var x1 = Math.min(w.x1, w.x2), x2 = Math.max(w.x1, w.x2);
            var y1 = Math.min(w.y1, w.y2), y2 = Math.max(w.y1, w.y2);
            var cx, cz;
            if (horizontal) { cx = (x1 + x2) / 2; cz = (y1 + y2) / 2; }
            else { cx = (x1 + x2) / 2; cz = (y1 + y2) / 2; }

            /* 收集这条墙上的窗（共线且重叠） */
            var openings = [];
            plan.windows.forEach(function (wd) {
                var wx1 = Math.min(wd.x1, wd.x2), wx2 = Math.max(wd.x1, wd.x2);
                var wy1 = Math.min(wd.y1, wd.y2), wy2 = Math.max(wd.y1, wd.y2);
                if (horizontal && Math.abs(wd.y1 - y1) < 1) {
                    if (wx2 > x1 && wx1 < x2) openings.push({ a: Math.max(wx1, x1), b: Math.min(wx2, x2) });
                } else if (!horizontal && Math.abs(wd.x1 - x1) < 1) {
                    if (wy2 > y1 && wy1 < y2) openings.push({ a: Math.max(wy1, y1), b: Math.min(wy2, y2) });
                }
            });
            openings.sort(function (p, q) { return p.a - q.a; });

            /* 分段生成：实墙 / 窗（玻璃 + 窗台 + 窗楣） */
            var cursor = horizontal ? x1 : y1;
            var end = horizontal ? x2 : y2;
            var mm = w.bearing ? M.wallB : M.wall;

            function solid(a, b) {
                var len2 = b - a; if (len2 <= 1) return;
                var mid = (a + b) / 2;
                if (horizontal) group.add(box(len2, H, w.t, mm, mid, H / 2, cz));
                else group.add(box(w.t, H, len2, mm, cx, H / 2, mid));
            }
            function windowAt(a, b) {
                var len2 = b - a; if (len2 <= 1) return;
                var mid = (a + b) / 2;
                if (curSection) { solid(a, b); return; }       // 剖切模式窗变实墙（简化）
                if (horizontal) {
                    group.add(box(len2, 900, w.t, mm, mid, 450, cz));            // 窗台
                    group.add(box(len2, 1500, w.t * 0.4, M.glass, mid, 1650, cz, false)); // 玻璃
                    group.add(box(len2, H - 2400, w.t, mm, mid, 2400 + (H - 2400) / 2, cz)); // 窗楣
                } else {
                    group.add(box(w.t, 900, len2, mm, cx, 450, mid));
                    group.add(box(w.t * 0.4, 1500, len2, M.glass, cx, 1650, mid, false));
                    group.add(box(w.t, H - 2400, len2, mm, cx, 2400 + (H - 2400) / 2, mid));
                }
            }

            openings.forEach(function (op) {
                if (op.a > cursor) solid(cursor, op.a);
                windowAt(op.a, op.b);
                cursor = op.b;
            });
            if (cursor < end) solid(cursor, end);
            dirSign = dirSign;                                  // 占位避免未使用告警
        });
    }

    /* ================= 地板与房间 ================= */
    function buildFloors(group) {
        plan.rooms.forEach(function (r) {
            var color = MATS_INDEX[r.mat] || 0xd9d9d4;
            var m = new THREE.Mesh(
                new THREE.BoxGeometry(r.w, 30, r.h),
                mat(color, 0.9)
            );
            m.position.set(r.x + r.w / 2, 15, r.y + r.h / 2);
            m.receiveShadow = true;
            group.add(m);
        });
    }

    /* ================= 家具 3D 建模（参数化拼装） ================= */
    function buildFurn(f) {
        var t = FURN[f.t];
        var g = new THREE.Group();
        var w = t.w, d = t.d, h = t.h;
        var wood = M.wood, dark = M.dark;

        switch (f.t) {
            case 'bed2': case 'bed1': {
                g.add(box(w, 260, d, wood, 0, 130, 0));                        // 床架
                g.add(box(w - 40, 200, d - 40, M.white, 0, 350, 30));          // 床垫
                g.add(box(w - 40, 120, d * 0.42, M.fabric, 0, 480, d * 0.18)); // 被子
                g.add(box(w * 0.3, 90, d * 0.2, M.white, -w * 0.22, 480, -d * 0.28)); // 枕头
                g.add(box(w * 0.3, 90, d * 0.2, M.white, w * 0.22, 480, -d * 0.28));
                g.add(box(w, 700, 60, wood, 0, 350, -d / 2 + 30));             // 床头板
                break;
            }
            case 'nstand': case 'cab': case 'tvstand': {
                g.add(box(w, h, d, wood, 0, h / 2, 0));
                g.add(box(w * 0.9, 40, d * 0.4, dark, 0, h * 0.55, d * 0.28)); // 抽屉缝
                break;
            }
            case 'ward': {
                g.add(box(w, h, d, wood, 0, h / 2, 0));
                g.add(box(w * 0.48, h * 0.92, 20, dark, -w * 0.25, h / 2, d / 2));
                g.add(box(w * 0.48, h * 0.92, 20, dark, w * 0.25, h / 2, d / 2));
                g.add(cyl(18, 18, 140, M.metal, -w * 0.06, h / 2, d / 2 + 12));
                g.add(cyl(18, 18, 140, M.metal, w * 0.06, h / 2, d / 2 + 12));
                break;
            }
            case 'dress': case 'desk': {
                g.add(box(w, 45, d, wood, 0, h - 22, 0));                      // 桌面
                [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
                    g.add(box(40, h - 45, 40, dark, s[0] * (w / 2 - 30), (h - 45) / 2, s[1] * (d / 2 - 30)));
                });
                if (f.t === 'dress') g.add(cyl(120, 120, 14, M.glass, 0, h + 7, 0)); // 化妆镜
                break;
            }
            case 'sofa3': case 'sofa1': {
                g.add(box(w, 320, d, M.fabric, 0, 190, 0));                    // 底座
                g.add(box(w, 320, 200, M.fabric, 0, 500, -d / 2 + 100));       // 靠背
                g.add(box(180, 380, d, M.fabric, -w / 2 + 90, 380, 0));        // 扶手
                g.add(box(180, 380, d, M.fabric, w / 2 - 90, 380, 0));
                var cush = f.t === 'sofa3' ? 3 : 1;
                for (var ci = 0; ci < cush; ci++) {
                    var cw = (w - 400) / cush;
                    g.add(box(cw - 24, 130, d - 240, M.white, -w / 2 + 200 + cw * ci + cw / 2, 410, 40));
                }
                break;
            }
            case 'ctable': case 'dtable': {
                g.add(box(w, 40, d, wood, 0, h - 20, 0));
                [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
                    g.add(box(50, h - 40, 50, dark, s[0] * (w / 2 - 45), (h - 40) / 2, s[1] * (d / 2 - 45)));
                });
                break;
            }
            case 'dchair': case 'chair': {
                g.add(box(w, 45, d, wood, 0, 430, 0));                         // 座面
                g.add(box(w - 60, h - 430, 45, wood, 0, 430 + (h - 430) / 2, -d / 2 + 24)); // 靠背
                [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
                    g.add(box(34, 430, 34, dark, s[0] * (w / 2 - 28), 215, s[1] * (d / 2 - 28)));
                });
                break;
            }
            case 'tv': {
                g.add(box(w, h * 0.62, 60, dark, 0, h * 0.5, 0));              // 屏
                g.add(box(w * 0.3, 30, 160, dark, 0, 60, 0));                  // 底座
                /* 发光屏幕面 */
                var scr = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h * 0.52),
                    new THREE.MeshBasicMaterial({ color: 0x3a5a8c }));
                scr.position.set(0, h * 0.5, 32);
                g.add(scr);
                break;
            }
            case 'plant': {
                g.add(cyl(w * 0.28, w * 0.34, 320, mat(0xb0603c), 0, 160, 0)); // 花盆
                g.add(cyl(0, 0, 0, M.green));                                  // 占位
                for (var s = 0; s < 3; s++) {
                    var ball = new THREE.Mesh(new THREE.SphereGeometry(w * (0.3 - s * 0.05), 10, 8), M.green);
                    ball.position.set((s - 1) * w * 0.18, 460 + s * 210, 0);
                    ball.castShadow = true;
                    g.add(ball);
                }
                break;
            }
            case 'stove': {
                g.add(box(w, h, d, mat(0x98a2ae), 0, h / 2, 0));
                g.add(box(w * 0.9, 24, d * 0.8, dark, 0, h + 12, 0));          // 灶面
                g.add(cyl(90, 90, 20, M.dark, -w * 0.18, h + 30, 0));          // 灶眼
                g.add(cyl(90, 90, 20, M.dark, w * 0.18, h + 30, 0));
                break;
            }
            case 'fridge': {
                g.add(box(w, h, d, M.metal, 0, h / 2, 0));
                g.add(box(w * 0.9, 16, 14, dark, 0, h * 0.6, d / 2));          // 门缝
                g.add(cyl(16, 16, 240, dark, w / 2 - 40, h * 0.55, d / 2 + 8));
                break;
            }
            case 'toilet': {
                g.add(box(w * 0.8, 380, d * 0.42, M.white, 0, 190, -d * 0.22)); // 水箱
                g.add(cyl(w * 0.36, w * 0.42, 400, M.white, 0, 200, d * 0.1, 20)); // 座圈
                g.add(box(w * 0.76, 30, d * 0.4, M.white, 0, 415, d * 0.1));
                break;
            }
            case 'sink': {
                g.add(box(w, 140, d, wood, 0, h - 70, 0));                     // 台面
                g.add(box(w * 0.72, 120, d * 0.66, M.white, 0, h - 60, 0));    // 盆体
                g.add(cyl(14, 14, 180, M.metal, 0, h + 90, -d * 0.2));         // 龙头
                break;
            }
            case 'shower': {
                g.add(box(w, 80, d, mat(0xdfe6ea), 0, 40, 0));                 // 底盆
                var glassP = new THREE.Mesh(new THREE.BoxGeometry(w, 1800, 30), M.glass);
                glassP.position.set(0, 980, d / 2); g.add(glassP);
                g.add(cyl(60, 60, 16, M.metal, 0, 1900, -d * 0.3));            // 花洒头
                g.add(cyl(12, 12, 500, M.metal, 0, 1650, -d * 0.3));
                break;
            }
            case 'washer': {
                g.add(box(w, h, d, mat(0xd6dade), 0, h / 2, 0));
                var door = new THREE.Mesh(new THREE.CylinderGeometry(170, 170, 24, 20), M.dark);
                door.rotation.x = Math.PI / 2;
                door.position.set(0, h * 0.55, d / 2);
                g.add(door);
                break;
            }
            case 'bshelf': {
                g.add(box(w, h, d, wood, 0, h / 2, 0));
                for (var b2 = 1; b2 <= 4; b2++) {
                    g.add(box(w - 40, 20, d - 30, dark, 0, h * b2 / 5, 12));
                }
                break;
            }
            default:
                g.add(box(w, h, d, wood, 0, h / 2, 0));
        }
        return g;
    }

    function buildFurniture(group) {
        plan.furniture.forEach(function (f) {
            var g = buildFurn(f);
            g.position.set(f.x, 0, f.y);
            g.rotation.y = -f.rot * Math.PI / 180;
            group.add(g);
        });
    }

    /* ================= 场景重建 ================= */
    function rebuild() {
        if (wallGroup) scene.remove(wallGroup);
        if (furnGroup) scene.remove(furnGroup);
        if (floorGroup) scene.remove(floorGroup);
        wallGroup = new THREE.Group();
        furnGroup = new THREE.Group();
        floorGroup = new THREE.Group();
        buildWalls(wallGroup);
        buildFloors(floorGroup);
        buildFurniture(furnGroup);
        scene.add(floorGroup, wallGroup, furnGroup);
    }

    /* ================= 灯光 ================= */
    function buildLights() {
        sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        var sc = sun.shadow.camera;
        sc.left = -9000; sc.right = 9000; sc.top = 9000; sc.bottom = -9000; sc.far = 60000;
        scene.add(sun);
        setSun(55);
        /* 夜景：每间房一盏暖光 */
        plan.rooms.forEach(function (r) {
            var pl = new THREE.PointLight(0xffc98a, 0, 7000, 2);
            pl.position.set(r.x + r.w / 2, 2400, r.y + r.h / 2);
            scene.add(pl);
            roomLights.push(pl);
        });
    }
    function setSun(deg) {
        if (!sun) return;
        var rad = deg * Math.PI / 180;
        var R = 20000;
        sun.position.set(
            4800 + Math.sin(rad) * R,
            6000 + Math.cos(rad * 0.6) * 9000,
            3900 - Math.cos(rad) * R * 0.6
        );
    }
    function applyNight() {
        sun.intensity = curNight ? 0 : 1.15;
        ambient.intensity = curNight ? 0.18 : 0.55;
        ambient.color.set(curNight ? 0x334466 : 0xcfd8e8);
        roomLights.forEach(function (pl) { pl.intensity = curNight ? 0.85 : 0; });
    }

    /* ================= 漫游 ================= */
    function eyePos() { return camera.position; }

    function walkStep(dt) {
        var spd = (keys['ShiftLeft'] || keys['ShiftRight']) ? 7000 : 3500;   // mm/s
        var mx = 0, mz = 0;
        if (keys['KeyW'] || keys['ArrowUp']) mz -= 1;
        if (keys['KeyS'] || keys['ArrowDown']) mz += 1;
        if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
        if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
        if (joy) { mx += joy.dx; mz += joy.dy; }
        var len = Math.hypot(mx, mz);
        if (!len) return;
        mx /= len; mz /= len;
        var sin = Math.sin(yaw), cos = Math.cos(yaw);
        var dx = (mx * cos - mz * sin) * spd * dt;
        var dz = (mx * sin + mz * cos) * spd * dt;

        /* 分轴移动 + 圆形碰撞（对每段墙做点-线段距离） */
        var r = 160;
        function collides(x, z) {
            for (var i = 0; i < plan.walls.length; i++) {
                var w = plan.walls[i];
                var wx1 = Math.min(w.x1, w.x2), wx2 = Math.max(w.x1, w.x2);
                var wy1 = Math.min(w.y1, w.y2), wy2 = Math.max(w.y1, w.y2);
                var t = 0;
                var dx = wx2 - wx1, dz = wy2 - wy1;
                var len2 = dx * dx + dz * dz;
                if (len2) t = Math.max(0, Math.min(1, ((x - wx1) * dx + (z - wy1) * dz) / len2));
                var px = wx1 + dx * t, pz = wy1 + dz * t;
                if (Math.hypot(x - px, z - pz) < r + w.t / 2) return true;
            }
            return false;
        }
        var nx = camera.position.x + dx;
        if (!collides(nx, camera.position.z)) camera.position.x = nx;
        var nz = camera.position.z + dz;
        if (!collides(camera.position.x, nz)) camera.position.z = nz;
    }

    /* ================= 主循环 ================= */
    function animate() {
        raf = requestAnimationFrame(animate);
        var dt = 1 / 60;
        if (walk) {
            walkStep(dt);
            camera.rotation.set(pitch, yaw, 0, 'YXZ');
        } else if (controls) {
            controls.update();
        }
        if (flyT) {
            flyT.t += dt / 0.8;
            var k = Math.min(1, flyT.t);
            var e = 1 - Math.pow(1 - k, 3);                 // easeOutCubic
            camera.position.lerpVectors(flyT.fromP, flyT.toP, e);
            controls.target.lerpVectors(flyT.fromT, flyT.toT, e);
            if (k >= 1) flyT = null;
        }
        renderer.render(scene, camera);
    }

    /* ================= 对外接口 ================= */
    window.Floor3D = {
        enter: function (cvEl, p, furnTypes) {
            canvas = cvEl; plan = p; FURN = furnTypes || {};
            if (!renderer) {
                renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
                renderer.shadowMap.enabled = true;
                renderer.shadowMap.type = THREE.PCFSoftShadowMap;
                initMats();
            }
            scene = scene || new THREE.Scene();
            scene.background = new THREE.Color(0x0d1320);
            camera = camera || new THREE.PerspectiveCamera(55, 1, 20, 200000);
            ambient = ambient || new THREE.AmbientLight(0xcfd8e8, 0.55);
            if (!scene.children.length) {
                scene.add(ambient);
                buildLights();
            }
            roomLights = roomLights.filter(function (pl) { return pl.parent; });
            rebuild();
            applyNight();

            if (!controls) {
                controls = new THREE.OrbitControls(camera, renderer.domElement);
                controls.maxPolarAngle = 1.5;
                controls.minDistance = 1500;
                controls.maxDistance = 50000;
                controls.enableDamping = true;
                controls.dampingFactor = 0.08;
            }
            controls.target.set(4800, 0, 3900);
            camera.position.set(4800, 15000, 13000);
            camera.lookAt(controls.target);
            this.fit();
            this.resize();
            setWalk(false);
            if (!raf) animate();
        },
        sync: function (p) { plan = p; if (scene) { rebuild(); applyNight(); } },
        leave: function () {
            if (raf) { cancelAnimationFrame(raf); raf = null; }
            this.setWalk(false);
        },
        resize: function () {
            if (!renderer) return;
            var w = canvas.clientWidth || canvas.parentElement.clientWidth;
            var h = canvas.clientHeight || canvas.parentElement.clientHeight;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        },
        fit: function () {
            if (!controls) return;
            controls.target.set(4800, 0, 3900);
            camera.position.set(4800, 15000, 12500);
        },
        focusRoom: function (i) {
            if (!plan.rooms[i]) return;
            var r = plan.rooms[i];
            var cx = r.x + r.w / 2, cz = r.y + r.h / 2;
            var dist = Math.max(r.w, r.h) * 1.5;
            flyT = {
                t: 0,
                fromP: camera.position.clone(),
                toP: new THREE.Vector3(cx, dist * 0.9, cz + dist * 0.7),
                fromT: controls.target.clone(),
                toT: new THREE.Vector3(cx, 0, cz)
            };
            setWalk(false);
        },
        setSun: function (deg) { setSun(deg); },
        setNight: function (b) { curNight = b; applyNight(); },
        setSection: function (b) { curSection = b; rebuild(); },
        setWalk: function (b) {
            walk = b;
            if (controls) controls.enabled = !b;
            if (b) {
                yaw = Math.PI; pitch = -0.05;
                camera.position.set(6900, 1600, 7000);          // 从过道出发
                canvas.requestPointerLock = canvas.requestPointerLock || function () { };
                try { canvas.requestPointerLock(); } catch (e) { }
                bindWalkInput();
                toast3D('漫游中：WASD 移动 · 鼠标转视角 · Esc 退出');
            } else {
                document.exitPointerLock && document.exitPointerLock();
                unbindWalkInput();
            }
        },
        exitWalk: function () { this.setWalk(false); },
        screenshot: function () {
            renderer.render(scene, camera);
            return renderer.domElement.toDataURL('image/png');
        }
    };

    /* ---------- 漫游输入 ---------- */
    var walkBound = false;
    function bindWalkInput() {
        if (walkBound) return; walkBound = true;
        document.addEventListener('mousemove', onMouseLook);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        canvas.addEventListener('touchstart', onTouch);
        canvas.addEventListener('touchmove', onTouch);
        canvas.addEventListener('touchend', onTouchEnd);
    }
    function unbindWalkInput() {
        if (!walkBound) return; walkBound = false;
        document.removeEventListener('mousemove', onMouseLook);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('touchstart', onTouch);
        canvas.removeEventListener('touchmove', onTouch);
        canvas.removeEventListener('touchend', onTouchEnd);
        joy = null; look = null;
    }
    function onMouseLook(e) {
        if (!walk || document.pointerLockElement !== canvas) return;
        yaw -= e.movementX * 0.0024;
        pitch -= e.movementY * 0.0024;
        pitch = Math.max(-1.2, Math.min(1.2, pitch));
    }
    function onKeyDown(e) { keys[e.code] = true; }
    function onKeyUp(e) { keys[e.code] = false; }
    function onTouch(e) {
        if (!walk) return;
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
            var t = e.changedTouches[i];
            if (t.clientX < innerWidth / 2) {
                if (!joy) joy = { ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
                joy.dx = Math.max(-1, Math.min(1, (t.clientX - joy.ox) / 60));
                joy.dy = Math.max(-1, Math.min(1, (t.clientY - joy.oy) / 60));
            } else {
                if (!look) { look = { lx: t.clientX, ly: t.clientY }; continue; }
                yaw -= (t.clientX - look.lx) * 0.005;
                pitch -= (t.clientY - look.ly) * 0.005;
                pitch = Math.max(-1.2, Math.min(1.2, pitch));
                look.lx = t.clientX; look.ly = t.clientY;
            }
        }
    }
    function onTouchEnd(e) {
        for (var i = 0; i < e.changedTouches.length; i++) {
            if (joy && e.changedTouches[i].clientX < innerWidth / 2) joy = null;
        }
        if (!e.touches.length) look = null;
    }

    /* toast（独立小实现，避免依赖 index 的 toast） */
    var t3d = null;
    function toast3D(msg) {
        if (!t3d) {
            t3d = document.createElement('div');
            t3d.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);'
                + 'background:rgba(35,43,58,.95);border:1px solid #4da3ff;color:#dfe7f3;'
                + 'padding:8px 20px;border-radius:8px;font-size:13px;z-index:400;';
            document.body.appendChild(t3d);
        }
        t3d.textContent = msg;
        t3d.style.display = 'block';
        clearTimeout(t3d._t);
        t3d._t = setTimeout(function () { t3d.style.display = 'none'; }, 2600);
    }
})();
