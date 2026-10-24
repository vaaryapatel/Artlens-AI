/* ArtLens AI — upload preview, drag & drop, in-page submit, result formatting
   Place at: lens/static/lens/js/main.js */

(function () {
    "use strict";

    var form = document.getElementById("analyze-form");
    var input = document.getElementById("artwork_image");
    var dropzone = document.getElementById("dropzone");
    var preview = document.getElementById("preview");
    var hint = document.getElementById("dropzone-hint");
    var submitBtn = document.getElementById("submit-btn");
    var resetBtn = document.getElementById("reset-btn");
    var statusEl = document.getElementById("status");
    var fileMeta = document.getElementById("file-meta");

    if (!form || !input) return;

    var previewUrl = null;

    /* ---------- Preview ---------- */
    function formatBytes(bytes) {
        if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function showPreview(file) {
        if (!file || !file.type || file.type.indexOf("image/") !== 0) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        preview.hidden = false;
        hint.hidden = true;
        resetBtn.hidden = false;

        if (fileMeta) {
            fileMeta.textContent = file.name + " · " + formatBytes(file.size);
            fileMeta.hidden = false;
        }
        enhanceResult();   // keep the result thumbnail in sync with the current image
    }

    function clearPreview() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        input.value = "";
        preview.removeAttribute("src");
        preview.hidden = true;
        hint.hidden = false;
        resetBtn.hidden = true;
        if (fileMeta) { fileMeta.hidden = true; fileMeta.textContent = ""; }
        setStatus("");
    }

    input.addEventListener("change", function () {
        if (input.files && input.files[0]) showPreview(input.files[0]);
    });

    resetBtn.addEventListener("click", function () {
        clearPreview();
        input.click();
    });

    /* ---------- Drag & drop ---------- */
    ["dragenter", "dragover"].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
            e.preventDefault();
            dropzone.classList.add("is-dragover");
        });
    });

    ["dragleave", "drop"].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
            e.preventDefault();
            dropzone.classList.remove("is-dragover");
        });
    });

    dropzone.addEventListener("drop", function (e) {
        var files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        try {
            input.files = files;          // keeps the real <input> in sync for form submit
        } catch (err) { /* older browsers: user can still click to upload */ }
        showPreview(files[0]);
    });

    /* ---------- Camera ----------
       "Take a photo" opens a live preview (getUserMedia), captures a frame to a
       JPEG File and drops it into the same <input type="file"> as a normal upload.
       Browsers only allow the camera on https:// or http://localhost; anywhere else
       (e.g. a phone opening http://192.168.x.x:8000) we fall back to the phone's
       native camera app through a capture-enabled file input. */
    var cameraBtn = document.getElementById("camera-btn");
    var cameraFallback = document.getElementById("camera_fallback");
    var modal = document.getElementById("camera-modal");
    var video = document.getElementById("camera-video");
    var cameraError = document.getElementById("camera-error");
    var captureBtn = document.getElementById("camera-capture");
    var switchBtn = document.getElementById("camera-switch");
    var closeBtn = document.getElementById("camera-close");

    var stream = null;
    var facing = "environment";   // back camera first; "user" = front

    function setInputFile(file) {
        try {
            var dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
        } catch (err) {
            // Very old browsers: preview still works, but the form can't submit this file
            console.warn("Could not attach captured photo to the form", err);
        }
        showPreview(file);
    }

    function stopStream() {
        if (stream) {
            stream.getTracks().forEach(function (t) { t.stop(); });
            stream = null;
        }
        if (video) video.srcObject = null;
    }

    function closeCamera() {
        stopStream();
        modal.hidden = true;
        document.removeEventListener("keydown", onCameraKey);
        if (cameraBtn) cameraBtn.focus();
    }

    function onCameraKey(e) {
        if (e.key === "Escape") closeCamera();
    }

    function showCameraError(message) {
        cameraError.textContent = message;
        cameraError.hidden = false;
        captureBtn.disabled = true;
    }

    function startStream() {
        stopStream();
        cameraError.hidden = true;
        captureBtn.disabled = false;

        return navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: facing },
                width: { ideal: 1920 },
                height: { ideal: 1440 }
            },
            audio: false
        }).then(function (s) {
            stream = s;
            video.srcObject = s;
            video.classList.toggle("is-front", facing === "user");
            // Only offer "Flip camera" when the device actually has more than one
            return navigator.mediaDevices.enumerateDevices().then(function (devices) {
                var cams = devices.filter(function (d) { return d.kind === "videoinput"; });
                switchBtn.hidden = cams.length < 2;
            });
        });
    }

    function openCamera() {
        var canStream = window.isSecureContext !== false &&
                        navigator.mediaDevices && navigator.mediaDevices.getUserMedia;

        if (!canStream) {
            console.warn("ArtLens: live camera unavailable. secureContext=" + window.isSecureContext +
                         ", origin=" + window.location.origin);

            // Phones: hand off to the native camera app
            var isTouch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
            if (isTouch && cameraFallback) { cameraFallback.click(); return; }

            // Desktops: say why, instead of silently doing nothing
            modal.hidden = false;
            document.addEventListener("keydown", onCameraKey);
            captureBtn.hidden = true;
            switchBtn.hidden = true;
            showCameraError("The browser blocks the camera on this address (" + window.location.host +
                            "). Open the site at http://localhost:8000 or http://127.0.0.1:8000 and try again.");
            return;
        }
        captureBtn.hidden = false;

        modal.hidden = false;
        document.addEventListener("keydown", onCameraKey);
        captureBtn.focus();

        startStream().catch(function (err) {
            console.error(err);
            var name = err && err.name;
            if (name === "NotAllowedError" || name === "SecurityError") {
                showCameraError("Camera access was blocked. Allow it in your browser’s address bar, then try again.");
            } else if (name === "NotFoundError" || name === "OverconstrainedError") {
                showCameraError("No camera was found on this device.");
            } else if (name === "NotReadableError") {
                showCameraError("The camera is being used by another app. Close it and try again.");
            } else {
                showCameraError("Couldn’t start the camera.");
            }
        });
    }

    function capturePhoto() {
        if (!stream || !video.videoWidth) return;

        var canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(function (blob) {
            if (!blob) { showCameraError("Couldn’t capture the photo. Please try again."); return; }
            var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            var file = new File([blob], "camera-" + stamp + ".jpg", { type: "image/jpeg" });
            closeCamera();
            setInputFile(file);
        }, "image/jpeg", 0.92);
    }

    if (cameraBtn && modal && video) {
        cameraBtn.addEventListener("click", openCamera);
        captureBtn.addEventListener("click", capturePhoto);
        closeBtn.addEventListener("click", closeCamera);

        switchBtn.addEventListener("click", function () {
            facing = facing === "environment" ? "user" : "environment";
            startStream().catch(function () {
                facing = facing === "environment" ? "user" : "environment";   // revert on failure
                startStream().catch(function () { showCameraError("Couldn’t switch cameras."); });
            });
        });

        // Clicking the dark backdrop (not the panel) closes the camera
        modal.addEventListener("click", function (e) {
            if (e.target === modal) closeCamera();
        });

        window.addEventListener("pagehide", stopStream);
    }

    // Native-camera fallback: copy the shot into the main upload input
    if (cameraFallback) {
        cameraFallback.addEventListener("change", function () {
            if (cameraFallback.files && cameraFallback.files[0]) {
                setInputFile(cameraFallback.files[0]);
                cameraFallback.value = "";
            }
        });
    }

    /* ---------- Status line ---------- */
    function setStatus(message, isError) {
        if (!message) {
            statusEl.hidden = true;
            statusEl.classList.remove("is-error");
            return;
        }
        statusEl.textContent = message;
        statusEl.classList.toggle("is-error", !!isError);
        statusEl.hidden = false;
    }

    /* ---------- Result formatting ----------
       Gemini returns light markdown: **bold**, *italic*, "---" dividers,
       "### headings", "1. Section" titles and "-" bullets.
       Everything is HTML-escaped first, then a few safe patterns are converted. */
    function escapeHtml(s) {
        return s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function inline(s) {
        return escapeHtml(s)
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
    }

    function stripMarks(s) {
        return s.replace(/\*+/g, "").replace(/^#+\s*/, "").replace(/\s*:\s*$/, "").trim();
    }

    /* A short line like "1. Identification" or "**Composition & Structure**"
       reads as a heading rather than a list item or paragraph. */
    function looksLikeHeading(text, nextLine) {
        var plain = stripMarks(text);
        if (!plain || plain.length > 60 || /[.!?]$/.test(plain)) return false;
        var wrapped = /^\*\*[^*]+\*\*:?$/.test(text.trim());
        var endsWithColon = /:\s*\**$/.test(text.trim()) && plain.indexOf(":") === -1;
        var nextIsBullet = !!nextLine && /^[-*•]\s+/.test(nextLine.trim());
        return wrapped || endsWithColon || nextIsBullet;
    }

    function formatResult() {
        var el = document.getElementById("result-content");
        if (!el || el.classList.contains("prose--empty") || el.classList.contains("is-formatted")) return;

        var lines = el.textContent.replace(/\r\n/g, "\n").split("\n");
        var html = "";
        var listType = null;

        function closeList() {
            if (listType) { html += "</" + listType + ">"; listType = null; }
        }

        function nextNonEmpty(from) {
            for (var j = from; j < lines.length; j++) {
                if (lines[j].trim()) return lines[j];
            }
            return "";
        }

        function prevNonEmpty(from) {
            for (var j = from; j >= 0; j--) {
                if (lines[j].trim()) return lines[j];
            }
            return "";
        }

        function isNumbered(s) { return /^\s*\d+[.)]\s+/.test(s || ""); }

        lines.forEach(function (raw, i) {
            var line = raw.trim();
            if (!line) { closeList(); return; }

            // Horizontal dividers: ---, ***, ___
            if (/^([-*_])\1{2,}$/.test(line)) { closeList(); html += "<hr>"; return; }

            // Markdown headings: ## Title
            var md = line.match(/^(#{1,6})\s+(.*)$/);
            if (md) {
                closeList();
                html += (md[1].length <= 2 ? "<h2>" : "<h3>") + inline(stripMarks(md[2])) + (md[1].length <= 2 ? "</h2>" : "</h3>");
                return;
            }

            var bullet = line.match(/^[-*•]\s+(.*)$/);
            var numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
            var next = nextNonEmpty(i + 1);

            // "1. Identification" → section heading (keeps the number)
            // A lone short numbered line (neighbours aren't numbered) is a title, not a one-item list
            var loneTitle = numbered && !isNumbered(next) && !isNumbered(prevNonEmpty(i - 1)) &&
                            stripMarks(numbered[2]).length <= 60 && !/[.!?]$/.test(stripMarks(numbered[2]));

            if (numbered && (loneTitle || looksLikeHeading(numbered[2], next))) {
                closeList();
                html += "<h2>" + numbered[1] + ". " + escapeHtml(stripMarks(numbered[2])) + "</h2>";
                return;
            }

            if (bullet || numbered) {
                var type = bullet ? "ul" : "ol";
                if (listType !== type) { closeList(); html += "<" + type + ">"; listType = type; }
                html += "<li>" + inline((bullet || numbered)[numbered ? 2 : 1]) + "</li>";
                return;
            }

            closeList();

            // "**Composition & Structure**" on its own line → sub-heading
            if (looksLikeHeading(line, next) && /^\*\*/.test(line)) {
                html += "<h3>" + escapeHtml(stripMarks(line)) + "</h3>";
            } else {
                html += "<p>" + inline(line) + "</p>";
            }
        });
        closeList();

        // Don't start or end with a divider
        html = html.replace(/^(<hr>)+/, "").replace(/(<hr>)+$/, "");

        el.innerHTML = html;
        el.classList.add("is-formatted");
    }

    /* ---------- Left column: thumbnail, quick facts, copy button ---------- */
    var FACT_KEYS = [
        { label: "Title",   re: /^title$/i },
        { label: "Artist",  re: /^(artist|possible artist|artist\/era)$/i },
        { label: "Era",     re: /^(era|era\s*\/\s*movement|movement|style|period)$/i },
        { label: "Date",    re: /^(creation date|date|estimated (creation )?date|estimated date)$/i }
    ];

    function extractFacts(text) {
        var found = {};
        text.replace(/\r\n/g, "\n").split("\n").forEach(function (raw) {
            var line = raw.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
            var m = line.match(/^\**\s*([A-Za-z][A-Za-z \/]{1,40}?)\s*:?\**\s*:\s*\**\s*(.+)$/) ||
                    line.match(/^\*\*([A-Za-z][A-Za-z \/]{1,40}?):\*\*\s*(.+)$/);
            if (!m) return;
            var key = m[1].trim();
            var value = m[2].replace(/\*+/g, "").trim();
            if (!value || value.length > 140) return;
            FACT_KEYS.forEach(function (k) {
                if (!found[k.label] && k.re.test(key)) found[k.label] = value;
            });
        });
        return FACT_KEYS
            .filter(function (k) { return found[k.label]; })
            .map(function (k) { return { label: k.label, value: found[k.label] }; });
    }

    function enhanceResult() {
        var content = document.getElementById("result-content");
        var thumb = document.getElementById("result-thumb");
        var facts = document.getElementById("result-facts");
        var copyBtn = document.getElementById("copy-btn");
        if (!content) return;

        var hasResult = !content.classList.contains("prose--empty");

        // Thumbnail of the image you uploaded (shown whenever one is selected)
        if (thumb) {
            if (previewUrl && hasResult) {
                thumb.src = previewUrl;
                thumb.hidden = false;
            } else {
                thumb.hidden = true;
            }
        }

        if (!hasResult) return;

        // Quick facts pulled from the identification section
        if (facts && !facts.childElementCount) {
            var items = extractFacts(content.textContent || "");
            if (items.length) {
                items.forEach(function (f) {
                    var row = document.createElement("div");
                    var dt = document.createElement("dt");
                    var dd = document.createElement("dd");
                    dt.textContent = f.label;
                    dd.textContent = f.value;      // textContent: never interpreted as HTML
                    row.appendChild(dt);
                    row.appendChild(dd);
                    facts.appendChild(row);
                });
                facts.hidden = false;
            }
        }

        if (copyBtn) copyBtn.hidden = false;
    }

    /* Copy analysis (delegated: the result section is replaced after each analysis) */
    document.addEventListener("click", function (e) {
        var btn = e.target.closest && e.target.closest("#copy-btn");
        if (!btn) return;
        var content = document.getElementById("result-content");
        if (!content || !navigator.clipboard) return;
        navigator.clipboard.writeText(content.innerText.trim()).then(function () {
            var old = btn.textContent;
            btn.textContent = "Copied ✓";
            setTimeout(function () { btn.textContent = old; }, 1600);
        });
    });

    /* ---------- Submit without reloading ----------
       The page keeps your image preview while the result is swapped in.
       If anything goes wrong we fall back to a normal form submit. */
    form.addEventListener("submit", function (e) {
        if (!window.fetch || !window.DOMParser) return;      // fallback: normal POST
        e.preventDefault();

        if (!input.files || !input.files[0]) {
            setStatus("Please choose an image first.", true);
            return;
        }

        submitBtn.disabled = true;
        setStatus("Analyzing with Gemini. This can take a minute or two…");

        fetch(form.action || window.location.href, {
            method: "POST",
            body: new FormData(form),
            headers: { "X-Requested-With": "XMLHttpRequest" },
            credentials: "same-origin"
        })
            .then(function (res) {
                if (!res.ok) throw new Error("Server responded with " + res.status);
                return res.text();
            })
            .then(function (text) {
                var doc = new DOMParser().parseFromString(text, "text/html");
                var newSection = doc.getElementById("result-section");
                var oldSection = document.getElementById("result-section");
                if (!newSection || !oldSection) throw new Error("Unexpected response");

                oldSection.innerHTML = newSection.innerHTML;
                formatResult();
                enhanceResult();
                setStatus("");
                oldSection.scrollIntoView({ behavior: "smooth", block: "start" });
            })
            .catch(function (err) {
                console.error(err);
                setStatus("Something went wrong while analyzing. Please try again.", true);
            })
            .then(function () {
                submitBtn.disabled = false;
            });
    });

    /* Format a server-rendered result (non-JS fallback path or first load) */
    formatResult();
    enhanceResult();
})();