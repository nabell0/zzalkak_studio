(() => {
  "use strict";

  const ALLOWED_MIME = new Set(["image/png", "image/jpeg"]);
  const ALLOWED_EXT = new Set(["png", "jpg", "jpeg"]);
  const ERROR_MESSAGE = "PNG 또는 JPEG 파일만 업로드 가능합니다";
  const FONT_FAMILY = [
    '"Apple Color Emoji"',
    '"Segoe UI Emoji"',
    '"Segoe UI Symbol"',
    '"Noto Color Emoji"',
    '"Black Han Sans"',
    '"IBM Plex Sans KR"',
    "sans-serif",
  ].join(", ");
  const TEXT_PADDING_RATIO = 0.06;
  const MAX_WRAP_LINES = 400;
  const MAX_TEXT_CHARS = 8000;
  const STORAGE_KEY = "zzalkak_studio_templates";

  /** 화면비별 실제 캔버스 픽셀 해상도 */
  const RATIO_SIZES = {
    "1:1": { width: 1080, height: 1080 },
    "4:5": { width: 1080, height: 1350 },
    "9:16": { width: 1080, height: 1920 },
  };

  const canvas = document.getElementById("preview-canvas");
  const ctx = canvas.getContext("2d", { alpha: true });
  const canvasFrame = document.getElementById("canvas-frame");
  const canvasSizeLabel = document.getElementById("canvas-size-label");
  const placeholder = document.getElementById("canvas-placeholder");
  const imageInput = document.getElementById("image-input");
  const fileNameEl = document.getElementById("file-name");
  const uploadError = document.getElementById("upload-error");
  const textInput = document.getElementById("text-input");
  const posX = document.getElementById("pos-x");
  const posY = document.getElementById("pos-y");
  const posXValue = document.getElementById("pos-x-value");
  const posYValue = document.getElementById("pos-y-value");
  const fontSize = document.getElementById("font-size");
  const fontSizeValue = document.getElementById("font-size-value");
  const textColor = document.getElementById("text-color");
  const downloadFormat = document.getElementById("download-format");
  const downloadBtn = document.getElementById("download-btn");
  const attributionInput = document.getElementById("attribution-input");
  const ratioButtons = Array.from(document.querySelectorAll(".ratio-btn"));
  const templateSaveBtn = document.getElementById("template-save-btn");
  const templateUpdateBtn = document.getElementById("template-update-btn");
  const templateExportBtn = document.getElementById("template-export-btn");
  const templateImportInput = document.getElementById("template-import-input");
  const templateListEl = document.getElementById("template-list");
  const templateEmptyEl = document.getElementById("template-empty");
  const templateCountLabel = document.getElementById("template-count-label");
  const activeTemplateLabel = document.getElementById("active-template-label");

  /** @type {HTMLImageElement | null} */
  let uploadedImage = null;
  /** @type {string | null} 배경 이미지 Base64 (data URL) */
  let uploadedImageDataUrl = null;
  let currentRatio = "1:1";
  /** @type {string | null} 불러온 템플릿의 고유 id (인덱스 사용 금지) */
  let activeTemplateId = null;
  let errorHideTimer = null;

  const graphemeSegmenter =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  function isAllowedFile(file) {
    if (!file) return false;

    const mimeOk = ALLOWED_MIME.has(file.type);
    const ext = file.name.includes(".")
      ? file.name.split(".").pop().toLowerCase()
      : "";
    const extOk = ALLOWED_EXT.has(ext);

    if (file.type) return mimeOk;
    return extOk;
  }

  function showUploadError(message) {
    const msg = message || ERROR_MESSAGE;
    uploadError.hidden = false;
    uploadError.textContent = msg;
    alert(msg);

    window.clearTimeout(errorHideTimer);
    errorHideTimer = window.setTimeout(() => {
      uploadError.hidden = true;
    }, 5000);
  }

  function hideUploadError() {
    uploadError.hidden = true;
    window.clearTimeout(errorHideTimer);
  }

  function syncOutputs() {
    posXValue.textContent = posX.value;
    posYValue.textContent = posY.value;
    fontSizeValue.textContent = fontSize.value;
  }

  function getState() {
    return {
      text: textInput.value,
      xPercent: Number(posX.value),
      yPercent: Number(posY.value),
      fontSize: Number(fontSize.value),
      color: textColor.value,
    };
  }

  function fontCss(sizePx) {
    const size = Math.max(1, Number(sizePx) || 12);
    return `700 ${size}px ${FONT_FAMILY}`;
  }

  function measureWidth(text) {
    return ctx.measureText(text).width;
  }

  function toGraphemes(text) {
    if (graphemeSegmenter) {
      return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
    }
    return Array.from(text);
  }

  /**
   * 캔버스 비트맵 해상도·미리보기 프레임 비율을 화면비에 맞게 갱신
   */
  function applyAspectRatio(ratioKey) {
    const size = RATIO_SIZES[ratioKey] || RATIO_SIZES["1:1"];
    currentRatio = ratioKey;

    canvas.width = size.width;
    canvas.height = size.height;
    // width/height 재설정 시 비트맵은 투명으로 초기화됨 (검은 배경 fill 없음)
    canvasFrame.style.aspectRatio = `${size.width} / ${size.height}`;
    canvasSizeLabel.textContent = `${size.width} × ${size.height}`;

    ratioButtons.forEach((btn) => {
      const active = btn.dataset.ratio === ratioKey;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  /**
   * object-fit: cover — 소스 중앙 크롭 → 캔버스 전체 (극단 비율에서도 왜곡 없음)
   */
  function drawImageCover(image) {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const scale = Math.max(cw / iw, ch / ih);
    const sw = cw / scale;
    const sh = ch / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;

    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, cw, ch);
  }

  /**
   * maxWidth를 넘는 단일 토큰(긴 URL·붙여쓴 한글 등)을 그래핌 단위로 분할
   */
  function breakLongToken(token, maxWidth) {
    const graphemes = toGraphemes(token);
    const lines = [];
    let current = "";

    for (const g of graphemes) {
      const next = current + g;
      if (current && measureWidth(next) > maxWidth) {
        lines.push(current);
        current = g;
        // 단일 그래핌이 폭을 넘어도 한 줄에 넣고 진행 (무한 루프 방지)
        if (measureWidth(current) > maxWidth) {
          lines.push(current);
          current = "";
        }
      } else {
        current = next;
      }
    }

    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }

  /**
   * 띄어쓰기 우선 줄바꿈 + 영문 단어 중간 절단 방지.
   * 한글/이모지/공백 없는 긴 토큰만 그래핌 단위로 분할.
   */
  function wrapParagraph(paragraph, maxWidth) {
    if (paragraph === "") return [""];

    const tokens = paragraph.split(/(\s+)/);
    const lines = [];
    let current = "";

    const pushCurrent = () => {
      lines.push(current.replace(/\s+$/u, ""));
      current = "";
    };

    for (const token of tokens) {
      if (token === "") continue;

      if (/^\s+$/u.test(token)) {
        if (!current) continue;
        const withSpace = current + token;
        if (measureWidth(withSpace) <= maxWidth) {
          current = withSpace;
        }
        // 줄 끝 공백이 넘치면 버리고 다음 토큰에서 새 줄
        continue;
      }

      const candidate = current + token;
      if (measureWidth(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current.replace(/\s+$/u, "") !== "") {
        pushCurrent();
      }

      if (measureWidth(token) <= maxWidth) {
        current = token;
        continue;
      }

      const broken = breakLongToken(token, maxWidth);
      for (let i = 0; i < broken.length - 1; i += 1) {
        lines.push(broken[i]);
      }
      current = broken[broken.length - 1] || "";
    }

    const trimmed = current.replace(/\s+$/u, "");
    if (trimmed !== "") {
      lines.push(trimmed);
    } else if (lines.length === 0) {
      lines.push("");
    }

    return lines;
  }

  function wrapTextLines(rawText, maxWidth) {
    const clipped = String(rawText).slice(0, MAX_TEXT_CHARS);
    const paragraphs = clipped.replace(/\r\n/g, "\n").split("\n");
    const lines = [];

    for (const paragraph of paragraphs) {
      const wrapped = wrapParagraph(paragraph, maxWidth);
      for (const line of wrapped) {
        lines.push(line);
        if (lines.length >= MAX_WRAP_LINES) {
          return lines;
        }
      }
    }

    return lines;
  }

  /**
   * 세로 영역 초과 시에도 크래시 없이, 보이는 줄만 안전하게 그림
   */
  function drawTextOverlay(state) {
    if (!state.text || !/\S/u.test(state.text)) return;

    const safeSize = Math.min(Math.max(Number(state.fontSize) || 12, 1), 240);
    const x = (state.xPercent / 100) * canvas.width;
    const y = (state.yPercent / 100) * canvas.height;
    const padding = canvas.width * TEXT_PADDING_RATIO;
    const maxWidth = Math.max(1, canvas.width - padding * 2);
    const lineHeight = safeSize * 1.25;

    ctx.save();
    ctx.font = fontCss(safeSize);
    ctx.fillStyle = state.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = Math.max(2, safeSize / 18);

    // 캔버스 밖으로 나가는 텍스트는 클립 — 레이아웃/성능 방어
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.clip();

    const lines = wrapTextLines(state.text, maxWidth);
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    const minY = -lineHeight;
    const maxY = canvas.height + lineHeight;

    for (let index = 0; index < lines.length; index += 1) {
      const ly = startY + index * lineHeight;
      if (ly < minY || ly > maxY) continue;

      const line = lines[index];
      ctx.strokeText(line, x, ly);
      ctx.fillText(line, x, ly);
    }

    ctx.restore();
  }

  /**
   * 출처/라이선스 워터마크 (우측 하단)
   */
  function drawAttribution() {
    const credit = attributionInput.value.trim();
    if (!credit) return;

    const markSize = Math.max(11, Math.round(canvas.width * 0.016));
    const pad = Math.max(10, Math.round(canvas.width * 0.02));

    ctx.save();
    ctx.font = `500 ${markSize}px "IBM Plex Sans KR", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = Math.max(2, markSize / 8);
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";

    let text = credit;
    const maxWidth = canvas.width - pad * 2;
    while (text.length > 1 && measureWidth(text) > maxWidth) {
      text = `${text.slice(0, -2)}…`;
    }

    const x = canvas.width - pad;
    const y = canvas.height - pad;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /**
   * @param {{ opaqueBackground?: boolean }} [options]
   * opaqueBackground: JPEG 저장 시에만 흰 배경 (PNG·미리보기는 알파 유지)
   */
  function render(options = {}) {
    try {
      // clearRect → 투명 픽셀 유지 (투명 PNG 알파가 검게 깨지지 않음)
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (options.opaqueBackground) {
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      if (!uploadedImage) {
        placeholder.classList.remove("is-hidden");
        downloadBtn.disabled = true;
        return;
      }

      placeholder.classList.add("is-hidden");
      downloadBtn.disabled = false;
      drawImageCover(uploadedImage);
      drawTextOverlay(getState());
      drawAttribution();
    } catch (err) {
      // 렌더 실패해도 업로드 이미지·입력 폼 상태는 절대 초기화하지 않음
      console.error("렌더링 중 오류 (작업 상태 유지):", err);
    }
  }

  async function ensureFontsReady(sizePx) {
    if (!document.fonts) return;

    try {
      await document.fonts.load(fontCss(sizePx));
      await document.fonts.load(`400 ${sizePx}px "IBM Plex Sans KR"`);
      await document.fonts.ready;
    } catch (_) {
      // 폰트 API 실패 시에도 다운로드는 진행
    }
  }

  function loadImageFile(file) {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const image = new Image();

        image.onload = () => {
          try {
            const iw = image.naturalWidth || image.width;
            const ih = image.naturalHeight || image.height;
            if (!iw || !ih) {
              // 비정상 이미지 → 기존 작업 유지
              showUploadError("이미지를 읽을 수 없습니다. 다른 PNG/JPEG를 시도해 주세요.");
              imageInput.value = "";
              return;
            }

            // 성공 시에만 교체 — 실패 경로에서는 uploadedImage 미변경
            uploadedImage = image;
            uploadedImageDataUrl = typeof reader.result === "string" ? reader.result : null;
            fileNameEl.textContent = file.name;
            hideUploadError();
            render();
            syncTemplateActionState();
          } catch (err) {
            console.error("이미지 적용 오류 (작업 상태 유지):", err);
            showUploadError("이미지를 적용하는 중 오류가 발생했습니다.");
            imageInput.value = "";
          }
        };

        image.onerror = () => {
          // 디코딩 실패 — 기존 이미지/문구 유지
          showUploadError();
          imageInput.value = "";
        };

        image.src = reader.result;
      } catch (err) {
        console.error("이미지 로드 오류 (작업 상태 유지):", err);
        showUploadError();
        imageInput.value = "";
      }
    };

    reader.onerror = () => {
      showUploadError();
      imageInput.value = "";
    };

    try {
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("FileReader 오류 (작업 상태 유지):", err);
      showUploadError();
      imageInput.value = "";
    }
  }

  function onImageSelected(event) {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      if (!isAllowedFile(file)) {
        // 잘못된 파일 — 상태 보존, 입력만 리셋
        showUploadError();
        imageInput.value = "";
        return;
      }

      loadImageFile(file);
    } catch (err) {
      console.error("파일 선택 처리 오류 (작업 상태 유지):", err);
      showUploadError();
      imageInput.value = "";
    }
  }

  function onControlInput() {
    try {
      syncOutputs();
      render();
    } catch (err) {
      console.error("입력 반영 오류 (작업 상태 유지):", err);
    }
  }

  function onRatioClick(event) {
    try {
      const btn = event.currentTarget;
      const ratio = btn.dataset.ratio;
      if (!ratio || ratio === currentRatio) return;

      applyAspectRatio(ratio);
      render();
    } catch (err) {
      console.error("화면비 변경 오류 (작업 상태 유지):", err);
    }
  }

  async function onDownload() {
    if (!uploadedImage) {
      alert("먼저 이미지를 업로드해 주세요.");
      return;
    }

    const state = getState();
    const mime = downloadFormat.value === "image/jpeg" ? "image/jpeg" : "image/png";
    const ext = mime === "image/jpeg" ? "jpg" : "png";

    downloadBtn.disabled = true;
    downloadBtn.textContent = "준비 중…";

    try {
      await ensureFontsReady(state.fontSize);
      // JPEG는 알파 미지원 → 흰 배경, PNG는 투명 유지
      // 출처 워터마크는 render → drawAttribution 경로로 함께 합성
      render({ opaqueBackground: mime === "image/jpeg" });

      // 캔버스 재인코딩만 사용 — 원본 파일 직접 저장 금지 → EXIF/GPS 메타데이터 제거
      const dataUrl =
        mime === "image/jpeg"
          ? canvas.toDataURL(mime, 0.92)
          : canvas.toDataURL("image/png");

      const link = document.createElement("a");
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      link.href = dataUrl;
      link.download = `zzalkak_${currentRatio.replace(":", "x")}_${stamp}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("다운로드 오류 (작업 상태 유지):", err);
      alert("다운로드 중 오류가 발생했습니다. 편집 내용은 그대로 유지됩니다.");
    } finally {
      // 미리보기는 다시 투명 배경 기준으로 복구
      render();
      downloadBtn.disabled = !uploadedImage;
      downloadBtn.textContent = "이미지 다운로드";
    }
  }

  function createTemplateId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function loadTemplatesFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.imageData === "string" &&
          typeof item.ratio === "string"
      );
    } catch (err) {
      console.error("템플릿 불러오기 실패:", err);
      return [];
    }
  }

  function persistTemplates(templates) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
      return true;
    } catch (err) {
      console.error("템플릿 저장 실패:", err);
      alert("템플릿 저장에 실패했습니다. 저장 용량(localStorage)을 확인해 주세요.");
      return false;
    }
  }

  function snapshotEditorState() {
    const state = getState();
    return {
      imageData: uploadedImageDataUrl,
      text: state.text,
      x: state.xPercent,
      y: state.yPercent,
      fontSize: state.fontSize,
      color: state.color,
      ratio: currentRatio,
      source: attributionInput.value,
      updatedAt: Date.now(),
    };
  }

  /**
   * 가져오기용 필수 항목 검증 (하나라도 없으면 거부 → localStorage 유지)
   */
  function isValidTemplateObject(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    if (typeof item.id !== "string" || item.id.trim() === "") return false;
    if (typeof item.imageData !== "string" || item.imageData.trim() === "") return false;
    if (!/^data:image\/(png|jpeg|jpg)/i.test(item.imageData)) return false;
    if (typeof item.text !== "string") return false;
    if (typeof item.x !== "number" || !Number.isFinite(item.x)) return false;
    if (typeof item.y !== "number" || !Number.isFinite(item.y)) return false;
    if (typeof item.fontSize !== "number" || !Number.isFinite(item.fontSize)) return false;
    if (typeof item.color !== "string" || item.color.trim() === "") return false;
    if (typeof item.ratio !== "string" || !RATIO_SIZES[item.ratio]) return false;
    return true;
  }

  function validateImportPayload(parsed) {
    if (!Array.isArray(parsed)) {
      return { ok: false, message: "복원 파일은 템플릿 배열(JSON Array)이어야 합니다. 기존 데이터는 유지됩니다." };
    }
    if (parsed.length === 0) {
      return { ok: false, message: "복원할 템플릿이 비어 있습니다. 기존 데이터는 유지됩니다." };
    }

    for (let i = 0; i < parsed.length; i += 1) {
      if (!isValidTemplateObject(parsed[i])) {
        return {
          ok: false,
          message: `템플릿 #${i + 1}에 필수 항목(id, 이미지 데이터, 문구, 좌표, 폰트, 색상, 화면비)이 없거나 형식이 올바르지 않습니다. 기존 데이터는 유지됩니다.`,
        };
      }
    }

    return { ok: true, templates: parsed };
  }

  function onTemplateExport() {
    try {
      const templates = loadTemplatesFromStorage();
      if (templates.length === 0) {
        alert("백업할 템플릿이 없습니다.");
        return;
      }

      const blob = new Blob([JSON.stringify(templates, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      link.href = url;
      link.download = `zzalkak_templates_backup_${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("템플릿 백업 오류 (작업 상태 유지):", err);
      alert("템플릿 백업 중 오류가 발생했습니다. 기존 데이터는 유지됩니다.");
    }
  }

  function onTemplateImport(event) {
    const file = event.target.files && event.target.files[0];
    // 같은 파일 재선택 가능하도록 즉시 초기화 (실패해도 기존 데이터 보존)
    templateImportInput.value = "";
    if (!file) return;

    const nameOk = /\.json$/i.test(file.name) || file.type === "application/json";
    if (!nameOk) {
      alert("JSON 파일만 복원할 수 있습니다. 기존 템플릿은 유지됩니다.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      try {
        let parsed;
        try {
          parsed = JSON.parse(String(reader.result));
        } catch (_) {
          // 손상된 JSON — localStorage 절대 덮어쓰지 않음
          alert("JSON 파싱에 실패했습니다. 파일이 손상되었을 수 있습니다. 기존 템플릿은 유지됩니다.");
          return;
        }

        const validated = validateImportPayload(parsed);
        if (!validated.ok) {
          alert(validated.message);
          return;
        }

        const replaceAll = window.confirm(
          "확인: 기존 템플릿을 모두 가져온 목록으로 덮어씁니다.\n취소: 기존 목록에 합칩니다(같은 id는 가져오기 값으로 갱신)."
        );

        const existing = loadTemplatesFromStorage();
        let next;

        if (replaceAll) {
          next = validated.templates.map((item) => ({ ...item }));
        } else {
          const byId = new Map();
          existing.forEach((item) => byId.set(item.id, item));
          validated.templates.forEach((item) => byId.set(item.id, { ...item }));
          next = Array.from(byId.values());
        }

        if (!persistTemplates(next)) return;

        if (activeTemplateId && !next.some((item) => item.id === activeTemplateId)) {
          activeTemplateId = null;
        }

        renderTemplateList();
        alert(
          replaceAll
            ? `템플릿 ${next.length}개를 덮어쓰기로 복원했습니다.`
            : `템플릿을 합쳐 복원했습니다. (총 ${next.length}개)`
        );
      } catch (err) {
        console.error("템플릿 복원 오류 (작업 상태 유지):", err);
        alert("템플릿 복원 중 오류가 발생했습니다. 기존 데이터는 유지됩니다.");
      }
    };

    reader.onerror = () => {
      alert("파일을 읽는 중 오류가 발생했습니다. 기존 템플릿은 유지됩니다.");
    };

    try {
      reader.readAsText(file, "UTF-8");
    } catch (err) {
      console.error("FileReader 오류 (작업 상태 유지):", err);
      alert("파일을 열 수 없습니다. 기존 템플릿은 유지됩니다.");
    }
  }

  function syncTemplateActionState() {
    const hasImage = Boolean(uploadedImage && uploadedImageDataUrl);
    templateSaveBtn.disabled = !hasImage;
    templateUpdateBtn.disabled = !hasImage || !activeTemplateId;

    if (activeTemplateId) {
      activeTemplateLabel.textContent = `편집 중 템플릿 ID: ${activeTemplateId}`;
    } else {
      activeTemplateLabel.textContent = "불러온 템플릿 없음";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTemplateList() {
    const templates = loadTemplatesFromStorage();
    templateCountLabel.textContent = `${templates.length}개`;
    templateListEl.innerHTML = "";

    if (templates.length === 0) {
      templateEmptyEl.hidden = false;
      syncTemplateActionState();
      return;
    }

    templateEmptyEl.hidden = true;

    // 최신 저장이 위로 오도록 updatedAt 기준 정렬 (id는 건드리지 않음)
    const sorted = templates.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    sorted.forEach((tpl) => {
      const li = document.createElement("li");
      li.className = "template-item";
      if (tpl.id === activeTemplateId) li.classList.add("is-active");
      li.dataset.templateId = tpl.id;

      const previewText = (tpl.text || "").trim() || "(문구 없음)";
      const shortText =
        previewText.length > 28 ? `${previewText.slice(0, 28)}…` : previewText;

      li.innerHTML = `
        <img class="template-thumb" alt="" src="${escapeHtml(tpl.imageData)}" />
        <div class="template-meta">
          <p class="template-meta-title">${escapeHtml(shortText)}</p>
          <p class="template-meta-sub">${escapeHtml(tpl.ratio)} · ${escapeHtml(String(tpl.fontSize))}px</p>
          <div class="template-item-actions">
            <button type="button" class="template-load-btn" data-id="${escapeHtml(tpl.id)}">불러오기</button>
            <button type="button" class="template-delete-btn" data-id="${escapeHtml(tpl.id)}">삭제</button>
          </div>
        </div>
      `;

      templateListEl.appendChild(li);
    });

    syncTemplateActionState();
  }

  function loadImageFromDataUrl(dataUrl, fileLabel) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const iw = image.naturalWidth || image.width;
        const ih = image.naturalHeight || image.height;
        if (!iw || !ih) {
          reject(new Error("invalid image"));
          return;
        }
        uploadedImage = image;
        uploadedImageDataUrl = dataUrl;
        fileNameEl.textContent = fileLabel || "템플릿 이미지";
        resolve(image);
      };
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = dataUrl;
    });
  }

  async function applyTemplateById(templateId) {
    try {
      const templates = loadTemplatesFromStorage();
      const tpl = templates.find((item) => item.id === templateId);
      if (!tpl) {
        alert("템플릿을 찾을 수 없습니다.");
        renderTemplateList();
        return;
      }

      textInput.value = typeof tpl.text === "string" ? tpl.text : "";
      posX.value = String(Math.min(100, Math.max(0, Number(tpl.x) || 50)));
      posY.value = String(Math.min(100, Math.max(0, Number(tpl.y) || 50)));
      fontSize.value = String(Math.min(120, Math.max(12, Number(tpl.fontSize) || 48)));
      textColor.value = typeof tpl.color === "string" ? tpl.color : "#ffffff";
      attributionInput.value = typeof tpl.source === "string" ? tpl.source : "";

      const ratio = RATIO_SIZES[tpl.ratio] ? tpl.ratio : "1:1";
      applyAspectRatio(ratio);
      syncOutputs();

      await loadImageFromDataUrl(tpl.imageData, "템플릿에서 불러옴");
      activeTemplateId = tpl.id;
      hideUploadError();
      render();
      renderTemplateList();
    } catch (err) {
      console.error("템플릿 불러오기 오류 (작업 상태 유지):", err);
      alert("템플릿을 불러오는 중 오류가 발생했습니다. 기존 편집 내용은 유지됩니다.");
    }
  }

  function onTemplateSave() {
    try {
      if (!uploadedImage || !uploadedImageDataUrl) {
        alert("이미지를 먼저 업로드한 뒤 저장해 주세요.");
        return;
      }

      const snapshot = snapshotEditorState();
      const newTemplate = {
        id: createTemplateId(),
        ...snapshot,
      };

      const templates = loadTemplatesFromStorage();
      templates.push(newTemplate);

      if (!persistTemplates(templates)) return;

      activeTemplateId = newTemplate.id;
      renderTemplateList();
      alert("새 템플릿으로 저장했습니다.");
    } catch (err) {
      console.error("템플릿 생성 오류 (작업 상태 유지):", err);
      alert("템플릿 저장 중 오류가 발생했습니다. 편집 내용은 유지됩니다.");
    }
  }

  function onTemplateUpdate() {
    try {
      if (!activeTemplateId) {
        alert("덮어쓸 템플릿을 먼저 불러와 주세요.");
        return;
      }
      if (!uploadedImage || !uploadedImageDataUrl) {
        alert("이미지를 먼저 업로드한 뒤 수정해 주세요.");
        return;
      }

      const templates = loadTemplatesFromStorage();
      const targetId = activeTemplateId;
      const exists = templates.some((item) => item.id === targetId);
      if (!exists) {
        activeTemplateId = null;
        syncTemplateActionState();
        renderTemplateList();
        alert("대상 템플릿이 없어 덮어쓰기를 취소했습니다.");
        return;
      }

      // 고유 id로 해당 객체만 갱신 (배열 인덱스에 의존하지 않음)
      const next = templates.map((item) =>
        item.id === targetId
          ? { id: targetId, ...snapshotEditorState() }
          : item
      );

      if (!persistTemplates(next)) return;

      renderTemplateList();
      alert("현재 템플릿을 덮어썼습니다.");
    } catch (err) {
      console.error("템플릿 수정 오류 (작업 상태 유지):", err);
      alert("템플릿 수정 중 오류가 발생했습니다. 편집 내용은 유지됩니다.");
    }
  }

  function onTemplateDelete(templateId) {
    try {
      if (!templateId) return;
      const confirmed = window.confirm("이 템플릿을 삭제할까요?");
      if (!confirmed) return;

      const templates = loadTemplatesFromStorage();
      // 고유 id 기준 filter — 인덱스 사용 금지
      const next = templates.filter((item) => item.id !== templateId);

      if (!persistTemplates(next)) return;

      if (activeTemplateId === templateId) {
        activeTemplateId = null;
      }

      renderTemplateList();
    } catch (err) {
      console.error("템플릿 삭제 오류 (작업 상태 유지):", err);
      alert("템플릿 삭제 중 오류가 발생했습니다. 편집 내용은 유지됩니다.");
    }
  }

  function onTemplateListClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const loadBtn = target.closest(".template-load-btn");
    if (loadBtn) {
      const id = loadBtn.getAttribute("data-id");
      if (id) applyTemplateById(id);
      return;
    }

    const deleteBtn = target.closest(".template-delete-btn");
    if (deleteBtn) {
      const id = deleteBtn.getAttribute("data-id");
      if (id) onTemplateDelete(id);
    }
  }

  imageInput.addEventListener("change", onImageSelected);
  textInput.addEventListener("input", onControlInput);
  posX.addEventListener("input", onControlInput);
  posY.addEventListener("input", onControlInput);
  fontSize.addEventListener("input", onControlInput);
  textColor.addEventListener("input", onControlInput);
  attributionInput.addEventListener("input", onControlInput);
  ratioButtons.forEach((btn) => btn.addEventListener("click", onRatioClick));
  downloadBtn.addEventListener("click", onDownload);
  templateSaveBtn.addEventListener("click", onTemplateSave);
  templateUpdateBtn.addEventListener("click", onTemplateUpdate);
  templateExportBtn.addEventListener("click", onTemplateExport);
  templateImportInput.addEventListener("change", onTemplateImport);
  templateListEl.addEventListener("click", onTemplateListClick);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (uploadedImage) render();
    }).catch(() => {});
  }

  try {
    applyAspectRatio("1:1");
    syncOutputs();
    render();
    renderTemplateList(); // F5 후에도 localStorage 목록 복원
    syncTemplateActionState();
  } catch (err) {
    console.error("초기화 오류:", err);
  }
})();
