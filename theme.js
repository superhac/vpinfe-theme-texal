/*
ES-inspired pinball showcase theme.
Built around persistent DOM updates for smoother browsing.
*/

windowName = "";
currentTableIndex = 0;
config = null;
lastRenderedTableIndex = -1;
lastMoveDirection = 0;
let tableView = null;
let previewSwapToken = 0;
let mediaDelayTimer = null;
let rightStageDriftTween = null;
let selectorPulseTween = null;
let rippleTimelines = [];
let selectorFrameTimeline = null;

const mediaPreloadCache = new Map();

const vpin = new VPinFECore();
vpin.init();
window.vpin = vpin;
window.receiveEvent = receiveEvent;

vpin.ready.then(async () => {
    await vpin.call("get_my_window_name").then((result) => {
        windowName = result;
    });

    vpin.registerInputHandler(handleInput);
    config = await vpin.call("get_theme_config");
    updateScreen();
});

async function receiveEvent(message) {
    await vpin.handleEvent(message);

    if (message.type === "TableIndexUpdate") {
        currentTableIndex = message.index;
        updateScreen();
    }
    else if (message.type === "TableLaunching") {
        fadeOut();
    } else if (message.type === "TableLaunchComplete") {
        fadeIn();
    } else if (message.type === "RemoteLaunching") {
        showRemoteLaunchOverlay(message.table_name);
        fadeOut();
    } else if (message.type === "RemoteLaunchComplete") {
        hideRemoteLaunchOverlay();
        fadeIn();
    } else if (message.type === "TableDataChange") {
        currentTableIndex = message.index;
        updateScreen();
    }
}

async function handleInput(input) {
    switch (input) {
        case "joyleft":
            lastMoveDirection = -1;
            currentTableIndex = wrapIndex(currentTableIndex - 1, vpin.tableData.length);
            updateScreen();
            vpin.sendMessageToAllWindows({
                type: "TableIndexUpdate",
                index: currentTableIndex
            });
            break;
        case "joyright":
            lastMoveDirection = 1;
            currentTableIndex = wrapIndex(currentTableIndex + 1, vpin.tableData.length);
            updateScreen();
            vpin.sendMessageToAllWindows({
                type: "TableIndexUpdate",
                index: currentTableIndex
            });
            break;
        case "joyselect":
            vpin.stopTableAudio();
            vpin.sendMessageToAllWindows({ type: "TableLaunching" });
            await fadeOut();
            await vpin.launchTable(currentTableIndex);
            break;
        case "joyback":
            break;
    }
}

function updateScreen() {
    if (windowName === "table") {
        updateTableWindow();
        vpin.playTableAudio(currentTableIndex);
        preloadNearbyMedia();
    } else if (windowName === "bg") {
        updateBGWindow();
    } else if (windowName === "dmd") {
        updateDMDWindow();
    }
}

function updateTableWindow() {
    const container = document.getElementById("rootContainer");
    tableView = ensureTableView(container);

    if (!vpin.tableData || vpin.tableData.length === 0) {
        tableView.theme.style.display = "none";
        tableView.emptyState.style.display = "flex";
        return;
    }

    tableView.theme.style.display = "";
    tableView.emptyState.style.display = "none";

    const data = getDisplayData(currentTableIndex);
    updateBackdrop(tableView, data.bgUrl);
    updateSystemHeader(tableView, data);
    updateTitleBlock(tableView, data);
    updateMetadata(tableView, data);
    updatePreviewFooter(tableView, data);
    updateFeatureStrip(tableView.featureStrip, data.features);
    updateFeatureStrip(tableView.addonStrip, data.addons);
    updatePreview(tableView.previewPanel, data, isVideoEnabled("enable_table_video", true));
    updateTableList(tableView);
    animateTableSelection(tableView);

    lastRenderedTableIndex = currentTableIndex;
    lastMoveDirection = 0;
}

function updateBGWindow() {
    const container = document.getElementById("rootContainer");
    if (!vpin.tableData || vpin.tableData.length === 0) {
        container.innerHTML = "";
        return;
    }

    const bgUrl = vpin.getImageURL(currentTableIndex, "bg");
    const bgVideoUrl = vpin.getVideoURL(currentTableIndex, "bg");
    renderWindowMedia(container, bgUrl, bgVideoUrl, "Backglass");
}

function updateDMDWindow() {
    const container = document.getElementById("rootContainer");
    if (!vpin.tableData || vpin.tableData.length === 0) {
        container.innerHTML = "";
        return;
    }

    const dmdUrl = vpin.getImageURL(currentTableIndex, "dmd");
    const dmdVideoUrl = vpin.getVideoURL(currentTableIndex, "dmd");
    renderWindowMedia(container, dmdUrl, dmdVideoUrl, "DMD");
}

function ensureTableView(container) {
    if (tableView && tableView.container === container) return tableView;

    container.innerHTML = "";

    const emptyState = document.createElement("div");
    emptyState.className = "es-empty-state";
    emptyState.textContent = "No tables found";
    emptyState.style.display = "none";

    const theme = document.createElement("div");
    theme.className = "es-theme";
    theme.innerHTML = `
        <div class="es-backdrop"></div>
        <div class="es-atmosphere"></div>
        <div class="es-frame-lines"></div>
        <div class="es-screen-title">
            <div class="es-screen-title-wheel"></div>
            <div class="es-screen-title-copy">
                <h1 class="es-title-text"></h1>
                <div class="es-author-text"></div>
                <div class="es-preview-meta"></div>
            </div>
        </div>
        <div class="es-main-shell">
            <section class="es-left-stage"></section>
            <section class="es-center-stage">
                <div class="es-focus-stage">
                    <div class="es-preview-column">
                        <div class="es-preview-stack">
                            <div class="es-preview-panel"></div>
                        </div>
                        <div class="es-badge-band">
                            <section class="es-tag-panel">
                                <h2 class="es-tag-title">Features</h2>
                                <div class="es-tag-strip es-feature-strip"></div>
                            </section>
                            <section class="es-tag-panel">
                                <h2 class="es-tag-title">Add-ons</h2>
                                <div class="es-tag-strip es-addon-strip"></div>
                            </section>
                        </div>
                    </div>
                    <div class="es-meta-grid"></div>
                </div>
            </section>
            <aside class="es-right-stage">
                <div class="es-right-stage-glow"></div>
                <div class="es-right-stage-ripples">
                    <div class="es-right-stage-ripple"></div>
                    <div class="es-right-stage-ripple"></div>
                    <div class="es-right-stage-ripple"></div>
                    <div class="es-right-stage-ripple"></div>
                    <div class="es-right-stage-ripple"></div>
                    <div class="es-right-stage-ripple"></div>
                </div>
                <div class="es-system-panel">
                    <div class="es-system-mark"><img class="es-system-mark-image" alt=""></div>
                </div>
                <div class="es-list">
                    <div class="es-list-selector">
                        <div class="es-list-selector-outline"></div>
                        <div class="es-list-selector-corner tl"></div>
                        <div class="es-list-selector-corner tr"></div>
                        <div class="es-list-selector-corner bl"></div>
                        <div class="es-list-selector-corner br"></div>
                    </div>
                    <div class="es-list-track"></div>
                </div>
            </aside>
        </div>
    `;

    container.appendChild(emptyState);
    container.appendChild(theme);

    tableView = {
        container,
        emptyState,
        theme,
        backdrop: theme.querySelector(".es-backdrop"),
        screenTitle: theme.querySelector(".es-screen-title"),
        leftStage: theme.querySelector(".es-left-stage"),
        centerStage: theme.querySelector(".es-center-stage"),
        focusStage: theme.querySelector(".es-focus-stage"),
        bottomFooter: theme.querySelector(".es-bottom-footer"),
        previewColumn: theme.querySelector(".es-preview-column"),
        previewStack: theme.querySelector(".es-preview-stack"),
        rightStage: theme.querySelector(".es-right-stage"),
        rightStageGlow: theme.querySelector(".es-right-stage-glow"),
        rightStageRipples: [...theme.querySelectorAll(".es-right-stage-ripple")],
        systemMark: theme.querySelector(".es-system-mark"),
        headerWheel: theme.querySelector(".es-screen-title-wheel"),
        titleText: theme.querySelector(".es-title-text"),
        authorText: theme.querySelector(".es-author-text"),
        metaGrid: theme.querySelector(".es-meta-grid"),
        previewPanel: theme.querySelector(".es-preview-panel"),
        previewMeta: theme.querySelector(".es-preview-meta"),
        featureStrip: theme.querySelector(".es-feature-strip"),
        addonStrip: theme.querySelector(".es-addon-strip"),
        listSelector: theme.querySelector(".es-list-selector"),
        listTrack: theme.querySelector(".es-list-track")
    };

    return tableView;
}

function getDisplayData(index) {
    const table = vpin.getTableMeta(index);
    const info = table.meta.Info || {};
    const vpx = table.meta.VPXFile || {};

    const title = info.Title || vpx.filename || table.tableDirName || "Unknown Table";
    const manufacturer = info.Manufacturer || vpx.manufacturer || "Unknown";
    const year = info.Year || vpx.year || "";
    const authors = formatAuthors(info.Authors);
    const type = info.Type || vpx.type || "Pinball";
    const plays = coalesce(info.playcount, info.PlayCount, vpx.playcount, vpx.PlayCount, "Unknown");
    const lastPlayed = coalesce(info.lastplayed, info.LastPlayed, vpx.lastplayed, vpx.LastPlayed, "Unknown");
    const rating = coalesce(info.rating, info.Rating, vpx.rating, vpx.Rating, "N/A");

    return {
        index,
        title,
        manufacturer,
        year: year ? String(year) : "Unknown",
        authors,
        type,
        plays: String(plays),
        lastPlayed: formatLastPlayed(lastPlayed),
        rating: String(rating),
        synopsis: getSynopsis(info, vpx, title, manufacturer, year, type),
        wheelUrl: vpin.getImageURL(index, "wheel"),
        cabUrl: vpin.getImageURL(index, "cab"),
        tableUrl: vpin.getImageURL(index, "table"),
        bgUrl: vpin.getImageURL(index, "bg"),
        bgVideoUrl: vpin.getVideoURL(index, "bg"),
        dmdUrl: vpin.getImageURL(index, "dmd"),
        tableVideoUrl: vpin.getVideoURL(index, "table"),
        audioUrl: vpin.getAudioURL(index),
        features: buildFlags(vpx, [
            { key: "detectnfozzy", label: "Nfozzy" },
            { key: "detectfleep", label: "Fleep" },
            { key: "detectssf", label: "SSF" },
            { key: "detectfastflips", label: "FastFlips" },
            { key: "detectlut", label: "LUT" },
            { key: "detectscorebit", label: "ScoreBit" },
            { key: "detectflex", label: "FlexDMD" }
        ]),
        addons: buildFlags(vpx, [
            { key: "altSoundExists", label: "AltSound" },
            { key: "altColorExists", label: "AltColor" },
            { key: "pupPackExists", label: "PuP-Pack" }
        ])
    };
}

function isVideoEnabled(optionName, fallback = true) {
    if (!config || typeof config !== "object") return fallback;
    if (!(optionName in config)) return fallback;
    return Boolean(config[optionName]);
}

function createBackdropMedia(bgUrl) {
    if (hasUsableMedia(bgUrl)) {
        const image = document.createElement("img");
        image.className = "es-backdrop-media";
        image.src = bgUrl;
        image.alt = "";
        return image;
    }

    return null;
}

function updateBackdrop(view, bgUrl) {
    const targetUrl = bgUrl;
    if (!hasUsableMedia(targetUrl)) {
        view.backdrop.replaceChildren();
        delete view.backdrop.dataset.url;
        return;
    }

    const currentUrl = view.backdrop.dataset.url || "";
    if (currentUrl === targetUrl) return;

    const media = createBackdropMedia(bgUrl);
    if (!media) {
        view.backdrop.replaceChildren();
        delete view.backdrop.dataset.url;
        return;
    }

    const transitionToken = String(Date.now()) + Math.random().toString(16).slice(2);
    view.backdrop.dataset.transitionToken = transitionToken;

    const commitBackdropSwap = () => {
        if (view.backdrop.dataset.transitionToken !== transitionToken) return;
        const fadeLayer = document.createElement("div");
        fadeLayer.className = "es-backdrop-fade";
        fadeLayer.appendChild(media);
        view.backdrop.appendChild(fadeLayer);

        requestAnimationFrame(() => fadeLayer.classList.add("is-active"));
        setTimeout(() => {
            if (view.backdrop.dataset.transitionToken !== transitionToken) return;
            view.backdrop.replaceChildren(media);
            view.backdrop.dataset.url = targetUrl;
        }, 260);
    };

    const finalize = () => {
        if (view.backdrop.dataset.pendingUrl !== targetUrl) return;
        delete view.backdrop.dataset.pendingUrl;
        commitBackdropSwap();
    };

    view.backdrop.dataset.pendingUrl = targetUrl;

    media.addEventListener("load", finalize, { once: true });
    media.addEventListener("error", () => {
        if (view.backdrop.dataset.pendingUrl === targetUrl) {
            delete view.backdrop.dataset.pendingUrl;
        }
    }, { once: true });

    if (media.complete) {
        finalize();
    } else if (typeof media.decode === "function") {
        media.decode().then(finalize).catch(() => {});
    }
}

function updateTitleBlock(view, data) {
    view.titleText.textContent = data.title;
    view.authorText.textContent = data.authors;
}

function updateSystemHeader(view, data) {
    if (!view.systemMark) return;

    view.systemMark.replaceChildren();

    if (isVideoEnabled("enable_selector_header_bg_video", true) && hasUsableMedia(data.bgVideoUrl)) {
        const video = document.createElement("video");
        video.className = "es-system-mark-media";
        video.src = data.bgVideoUrl;
        video.poster = hasUsableMedia(data.bgUrl) ? data.bgUrl : "";
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        view.systemMark.appendChild(video);
        return;
    }

    if (hasUsableMedia(data.bgUrl)) {
        const image = document.createElement("img");
        image.className = "es-system-mark-media";
        image.src = data.bgUrl;
        image.alt = `${data.title} backglass`;
        view.systemMark.appendChild(image);
    }
}

function updateMetadata(view, data) {
    view.metaGrid.innerHTML = "";
}

function updatePreviewFooter(view, data) {
    view.headerWheel.innerHTML = "";

    const showFallback = () => {
        view.headerWheel.innerHTML = "";
        const fallback = document.createElement("div");
        fallback.className = "es-preview-wheel-fallback";
        fallback.textContent = data.title;
        view.headerWheel.appendChild(fallback);
    };

    if (hasUsableMedia(data.wheelUrl)) {
        const wheel = document.createElement("img");
        wheel.src = data.wheelUrl;
        wheel.alt = `${data.title} wheel`;
        wheel.onerror = showFallback;
        view.headerWheel.appendChild(wheel);
    } else {
        showFallback();
    }

    const metaParts = [data.year, data.manufacturer, data.type]
        .map((value) => String(value || "").trim())
        .filter((value) => value && value !== "Unknown");

    view.previewMeta.textContent = metaParts.join("  /  ");
}

function updateFeatureStrip(container, items) {
    container.innerHTML = "";
    items.forEach((item) => {
        const tag = document.createElement("span");
        tag.className = `es-tag${item.active ? " active" : ""}`;
        tag.textContent = item.label;
        container.appendChild(tag);
    });
}

function updatePreview(container, data, allowVideo = true) {
    const currentLayer = container.querySelector(".es-preview-layer");
    const token = ++previewSwapToken;
    const incoming = document.createElement("div");
    incoming.className = "es-preview-layer is-entering";
    incoming.dataset.url = data.tableUrl;

    const poster = document.createElement("img");
    poster.src = data.tableUrl;
    poster.alt = `${data.title} preview`;
    poster.onerror = () => {
        poster.removeAttribute("src");
    };
    incoming.appendChild(poster);
    container.appendChild(incoming);

    const activate = () => {
        if (token !== previewSwapToken) return;
        requestAnimationFrame(() => {
            incoming.classList.remove("is-entering");
            if (currentLayer) {
                currentLayer.classList.add("is-exiting");
                setTimeout(() => currentLayer.remove(), 220);
            }
        });
    };

    if (poster.complete) {
        activate();
    } else {
        poster.addEventListener("load", activate, { once: true });
        poster.addEventListener("error", activate, { once: true });
    }

    clearTimeout(mediaDelayTimer);
    mediaDelayTimer = setTimeout(() => {
        if (token !== previewSwapToken || !allowVideo || !hasUsableMedia(data.tableVideoUrl)) return;

        const video = document.createElement("video");
        video.src = data.tableVideoUrl;
        video.poster = data.tableUrl;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.addEventListener("loadeddata", () => {
            if (token !== previewSwapToken || !incoming.isConnected) return;
            incoming.replaceChildren(video);
        }, { once: true });
        video.onerror = () => {};
        video.load();
    }, 260);
}

function updateTableList(view) {
    const count = vpin.getTableCount();
    const visibleCount = 19;
    const centerSlot = Math.floor(visibleCount / 2);

    if (view.listTrack.children.length !== visibleCount) {
        view.listTrack.innerHTML = "";
        for (let index = 0; index < visibleCount; index += 1) {
            const item = document.createElement("div");
            item.className = "es-list-item";
            const label = document.createElement("span");
            label.className = "es-list-item-label";
            const scan = document.createElement("span");
            scan.className = "es-list-item-scan";
            item.append(label, scan);
            view.listTrack.appendChild(item);
        }
    }

    Array.from(view.listTrack.children).forEach((item, position) => {
        const index = wrapIndex(currentTableIndex + position - centerSlot, count);
        const table = vpin.getTableMeta(index);
        const info = table.meta.Info || {};
        const vpx = table.meta.VPXFile || {};
        const title = info.Title || vpx.filename || table.tableDirName || "Unknown Table";
        const label = item.querySelector(".es-list-item-label");
        label.textContent = title;
        item.classList.toggle("active", position === centerSlot);
        item.classList.toggle("near", Math.abs(position - centerSlot) <= 2 && position !== centerSlot);
    });
    view.listTrack.style.transform = "none";
}

function animateTableSelection(view) {
    if (!window.gsap) return;

    const direction = lastMoveDirection === 0 ? 1 : lastMoveDirection;
    const headerTargets = [view.headerWheel, view.titleText, view.authorText, view.previewMeta].filter(Boolean);
    const badgePanels = view.theme.querySelectorAll(".es-tag-panel");
    const badgeTargets = Array.from(badgePanels);
    const badgeChildren = badgeTargets.flatMap((panel) => {
        const title = panel.querySelector(".es-tag-title");
        const tags = Array.from(panel.querySelectorAll(".es-tag"));
        return [title, ...tags].filter(Boolean);
    });

    gsap.killTweensOf([
        view.leftStage,
        view.centerStage,
        view.rightStage,
        view.titleText,
        view.authorText,
        view.previewMeta,
        view.metaGrid,
        view.focusStage,
        view.previewStack,
        ...badgeTargets,
        ...badgeChildren
    ]);
    ensureSelectorPanelEffects(view);

    const firstPaint = lastRenderedTableIndex === -1;
    if (firstPaint) {
        gsap.fromTo(
            [view.leftStage, view.centerStage, view.rightStage],
            { opacity: 0, y: 24 },
            { opacity: 1, y: 0, duration: 0.68, ease: "power2.out", stagger: 0.08 }
        );
        return;
    }

    gsap.fromTo(
        headerTargets,
        {
            opacity: 0.16,
            x: direction * 14,
            y: -4,
            scale: 0.985
        },
        {
            opacity: 1,
            x: 0,
            y: 0,
            scale: 1,
            duration: 0.3,
            ease: "power2.out",
            stagger: 0.08
        }
    );

    gsap.fromTo(
        view.previewStack,
        {
            opacity: 0.22,
            x: direction * 18,
            scale: 0.985,
            rotate: direction * 0.25
        },
        {
            opacity: 1,
            x: 0,
            scale: 1,
            rotate: 0,
            duration: 0.28,
            ease: "power3.out"
        }
    );

    gsap.fromTo(
        badgeTargets,
        {
            opacity: 0.08,
            y: 28,
            x: direction * 18
        },
        {
            opacity: 1,
            y: 0,
            x: 0,
            duration: 0.62,
            ease: "power2.out",
            stagger: 0.1
        }
    );

    gsap.fromTo(
        badgeChildren,
        {
            opacity: 0,
            y: 18
        },
        {
            opacity: 1,
            y: 0,
            duration: 0.48,
            ease: "power2.out",
            stagger: 0.03,
            delay: 0.14
        }
    );

    const activeItem = view.listTrack.querySelector(".es-list-item.active");
    if (activeItem) {
        const scan = activeItem.querySelector(".es-list-item-scan");
        gsap.fromTo(
            activeItem,
            {
                x: lastMoveDirection > 0 ? 14 : -14,
                scaleX: 0.97,
                scaleY: 0.95,
                filter: "brightness(1.35)"
            },
            {
                x: 0,
                scaleX: 1,
                scaleY: 1,
                filter: "brightness(1)",
                duration: 0.24,
                ease: "power2.out"
            }
        );
        if (scan) {
            gsap.killTweensOf(scan);
            gsap.fromTo(
                scan,
                { xPercent: -180, opacity: 0 },
                {
                    xPercent: 180,
                    opacity: 1,
                    duration: 0.52,
                    ease: "power2.out"
                }
            );
        }
    }

    if (view.listSelector) {
        gsap.killTweensOf(view.listSelector);
        gsap.set(view.listSelector, {
            boxShadow: "0 0 24px rgba(255, 198, 106, 0.24), inset 0 0 0 1px rgba(255, 244, 213, 0.5)",
            opacity: 1
        });
    }
}

function ensureSelectorPanelEffects(view) {
    if (!window.gsap) return;

    if (view.rightStageGlow && !rightStageDriftTween) {
        gsap.set(view.rightStageGlow, {
            xPercent: -12,
            yPercent: -8,
            scale: 0.88,
            opacity: 0.5
        });

        rightStageDriftTween = gsap.to(view.rightStageGlow, {
            xPercent: 12,
            yPercent: 10,
            scale: 1.16,
            opacity: 0.9,
            duration: 4.8,
            ease: "sine.inOut",
            repeat: -1,
            yoyo: true
        });
    }

    if (Array.isArray(view.rightStageRipples) && view.rightStageRipples.length && rippleTimelines.length === 0) {
        view.rightStageRipples.forEach((ripple, index) => {
            const left = 18 + Math.random() * 64;
            const top = 18 + Math.random() * 66;
            const baseScale = 0.12 + Math.random() * 0.16;
            const maxScale = 2.1 + Math.random() * 1.5;
            const duration = 1.8 + Math.random() * 1.9;
            const intro = 0.18 + Math.random() * 0.24;

            gsap.set(ripple, {
                left: `${left}%`,
                top: `${top}%`,
                scale: baseScale,
                opacity: 0,
                xPercent: -50,
                yPercent: -50
            });

            const timeline = gsap.timeline({
                repeat: -1,
                delay: index * 0.45 + Math.random() * 0.6
            });

            timeline
                .to(ripple, {
                    opacity: 1,
                    duration: intro,
                    ease: "sine.out"
                })
                .to(ripple, {
                    scale: maxScale,
                    opacity: 0,
                    duration,
                    ease: "power1.out"
                }, 0);

            rippleTimelines.push(timeline);
        });
    }
}

function preloadNearbyMedia() {
    if (!vpin.tableData || vpin.getTableCount() === 0) return;

    const indices = [
        currentTableIndex,
        wrapIndex(currentTableIndex - 1, vpin.getTableCount()),
        wrapIndex(currentTableIndex + 1, vpin.getTableCount())
    ];

    indices.forEach((index) => {
        preloadImage(vpin.getImageURL(index, "table"));
        preloadImage(vpin.getImageURL(index, "bg"));
        preloadImage(vpin.getImageURL(index, "wheel"));
        preloadImage(vpin.getImageURL(index, "cab"));
        preloadImage(vpin.getImageURL(index, "dmd"));
    });
}

function preloadImage(url) {
    if (!hasUsableMedia(url) || mediaPreloadCache.has(url)) return;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    const promise = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    mediaPreloadCache.set(url, promise);
    if (mediaPreloadCache.size > 24) {
        const firstKey = mediaPreloadCache.keys().next().value;
        mediaPreloadCache.delete(firstKey);
    }
}

function buildFlags(vpx, items) {
    return items.map(({ key, label }) => ({
        label,
        active: isTruthyFlag(vpx[key])
    }));
}

function getSynopsis(info, vpx, title, manufacturer, year, type) {
    const direct = [
        info.Description,
        info.description,
        info.Overview,
        info.overview,
        info.Notes,
        info.notes,
        info.Rules,
        info.rules,
        vpx.description,
        vpx.notes
    ].find((value) => typeof value === "string" && value.trim());

    if (direct) {
        return truncateWords(cleanText(direct), 42);
    }

    const yearText = year ? ` from ${year}` : "";
    return `${title} is a ${type.toLowerCase()} table by ${manufacturer}${yearText}. Explore the playfield, load the media, and browse the collection with a front-end layout built to spotlight cab art, playfield action, DMD artwork, and table features.`;
}

function formatAuthors(authors) {
    if (Array.isArray(authors) && authors.length > 0) return authors.join(", ");
    if (typeof authors === "string" && authors.trim()) return authors.trim();
    return "Unknown";
}

function formatLastPlayed(value) {
    if (!value || value === "Unknown") return "Unknown";
    const text = String(value).trim();
    if (!text) return "Unknown";
    return text;
}

function truncateWords(text, limit) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= limit) return text;
    return `${words.slice(0, limit).join(" ")}...`;
}

function cleanText(text) {
    return String(text).replace(/\s+/g, " ").trim();
}

function isTruthyFlag(value) {
    return value === true || value === "true" || value === 1 || value === "1";
}

function hasUsableMedia(url) {
    return Boolean(url) && !String(url).includes("file_missing");
}

function renderWindowMedia(container, imageUrl, videoUrl, altText) {
    const existingMedia = container.querySelector("video, img");
    const wantsVideo = hasUsableMedia(videoUrl);

    if (existingMedia) {
        if (existingMedia.tagName === "VIDEO") {
            existingMedia.pause();
            existingMedia.removeAttribute("src");
            existingMedia.load();
        }
        existingMedia.remove();
    }

    if (wantsVideo) {
        const video = document.createElement("video");
        video.src = videoUrl;
        video.poster = hasUsableMedia(imageUrl) ? imageUrl : "";
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
        video.onerror = () => {
            if (!hasUsableMedia(imageUrl)) return;
            const fallback = document.createElement("img");
            fallback.src = imageUrl;
            fallback.alt = altText;
            fallback.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
            video.replaceWith(fallback);
        };
        container.appendChild(video);
        return;
    }

    const img = document.createElement("img");
    img.src = hasUsableMedia(imageUrl) ? imageUrl : "";
    img.alt = altText;
    img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
    container.appendChild(img);
}

function coalesce(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return value;
        }
    }
    return "";
}

function wrapIndex(index, length) {
    return (index + length) % length;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function fadeOut() {
    const overlay = document.getElementById("fadeOverlay");
    if (overlay) overlay.classList.add("show");
}

function fadeIn() {
    const overlay = document.getElementById("fadeOverlay");
    if (overlay) overlay.classList.remove("show");
}

function showRemoteLaunchOverlay(tableName) {
    const overlay = document.getElementById("remote-launch-overlay");
    const nameEl = document.getElementById("remote-launch-table-name");
    if (overlay && nameEl) {
        nameEl.textContent = tableName || "Unknown Table";
        overlay.style.display = "flex";
    }
}

function hideRemoteLaunchOverlay() {
    const overlay = document.getElementById("remote-launch-overlay");
    if (overlay) overlay.style.display = "none";
}
