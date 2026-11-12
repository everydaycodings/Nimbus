// The photo editor: crop, rotate, flip, straighten and markup. No colour adjustments.
// Opened from a photo's preview (Save makes a new version, Save as copy a second file), and before upload for camera shots and
// shared-in pictures (src/lib/photo-edit-session.ts). Geometry goes through expo-image-manipulator; markup is drawn with SVG on the
// result and flattened with react-native-view-shot. A JPEG keeps its EXIF date and GPS (shared/exif-write).
import { readExif, withExif } from "@nimbus/shared/exif-write";
import {
  MAX_ANGLE,
  dragCrop,
  fitAspect,
  innerSize,
  type Handle,
  type Rect,
} from "@nimbus/shared/image-edit";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowUUpLeft,
  ArrowUUpRight,
  ArrowUpRight,
  Crop,
  FlipHorizontal,
  Highlighter,
  PencilSimpleLine,
  TextT,
  X,
} from "phosphor-react-native";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  PanResponder,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Polygon, Text as SvgText } from "react-native-svg";
import { captureRef } from "react-native-view-shot";

import { Actions, Frame } from "@/components/dialog";
import { useSnack } from "@/components/snackbar";
import { Bar, Button, IconButton, Text } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { isOnline } from "@/lib/connectivity";
import { CHANGED, currentOf, uploadFile } from "@/lib/editor-save";
import { changedSince } from "@/lib/editor-rules";
import { fetchToCache } from "@/lib/file-cache";
import { useApi, useDetails } from "@/lib/files";
import {
  EDIT_LONG_SIDE,
  FULL,
  START,
  canEditPhoto,
  cropBox,
  flatSize,
  outFormat,
  same,
  type Geo,
} from "@/lib/photo-edit-rules";
import { peekRequest, type Edited, type Shot } from "@/lib/photo-edit-session";
import { c, radius } from "@/lib/theme";
import type { PreviewResponse } from "@nimbus/shared/api";

type Pt = [number, number];
// Markup is stored 0..1 of the cropped picture, widths 0..1 of its shorter side.
type Op =
  | { kind: "pen" | "highlighter"; color: string; w: number; pts: Pt[] }
  | { kind: "arrow"; color: string; w: number; a: Pt; b: Pt }
  | { kind: "text"; color: string; size: number; at: Pt; text: string };
type Tool = Op["kind"];

const COLORS = [
  ["Red", "#ef4444"],
  ["Yellow", "#facc15"],
  ["Green", "#22c55e"],
  ["Blue", "#3b82f6"],
  ["White", "#ffffff"],
  ["Black", "#000000"],
] as const;
const WIDTH: Record<Tool, number> = {
  pen: 0.008,
  highlighter: 0.04,
  arrow: 0.009,
  text: 0.07,
};
const TOOLS = [
  ["pen", "Pen", PencilSimpleLine],
  ["highlighter", "Highlighter", Highlighter],
  ["text", "Text", TextT],
  ["arrow", "Arrow", ArrowUpRight],
] as const;
const ASPECTS = [
  ["Free", null],
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["16:9", 16 / 9],
] as const;
const PREVIEW_SIDE = 1600;
const LIMIT = { maxWidth: EDIT_LONG_SIDE, maxHeight: EDIT_LONG_SIDE };
const FORMAT = {
  jpeg: SaveFormat.JPEG,
  png: SaveFormat.PNG,
  webp: SaveFormat.WEBP,
} as const;
const SHOT_FORMAT = { jpeg: "jpg", png: "png", webp: "webp" } as const;

type Size = { uri: string; width: number; height: number };
type Source = Shot & { takenAt?: Date };

// ---- Screens: one for a photo on the server, one for a picture about to go up ----

export default function PhotoEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [request] = useState(() => (id ? null : peekRequest()));
  useEffect(() => {
    if (!id && !request) router.back();
  }, [id, request]);
  if (id) return <ServerEdit id={id} />;
  return request ? <LocalEdit request={request} /> : null;
}

// Edit before upload: "Use edited photo" hands the new file back; leaving any other way keeps the original.
function LocalEdit({
  request,
}: {
  request: NonNullable<ReturnType<typeof peekRequest>>;
}) {
  const answered = useRef(false);
  const answer = useCallback(
    (r: Edited | null) => {
      if (answered.current) return;
      answered.current = true;
      request.done(r);
    },
    [request],
  );
  useEffect(() => () => answer(null), [answer]);
  return (
    <Editor
      source={request.shot}
      primary="Use edited photo"
      secondary="Upload original"
      onFinish={async (out, as) => {
        answer(as === "primary" ? out : null);
        router.back();
        return true;
      }}
      onLeave={() => router.back()}
    />
  );
}

// Edit a photo already in Nimbus. Save is a new version, unless the server's moved on; then Keep both.
function ServerEdit({ id }: { id: string }) {
  const api = useApi();
  const snack = useSnack();
  const details = useDetails(id);
  const item = details.data?.item ?? null;
  const parentId = details.data?.details.parentId ?? null;
  const editable = !!item && !item.trashedAt && canEditPhoto(item.mime);
  const [src, setSrc] = useState<Source | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const failed = item && !editable ? "This photo can't be edited." : loadError;
  const [ask, setAsk] = useState(false);
  const opened = useRef<string | null>(null);
  const held = useRef<Edited | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!item || started.current) return;
    started.current = true;
    if (!editable) return;
    (async () => {
      const url = async () =>
        (await api.get<PreviewResponse>(`/items/${item.id}/preview`)).url;
      const file = await fetchToCache(api.id, item.id, item.version, url);
      opened.current = item.version;
      setSrc({
        uri: file.uri,
        name: item.name,
        mime: item.mime!,
        takenAt: new Date(item.updatedAt),
      });
    })().catch((e) => setLoadError(errorText(e)));
  }, [item, api, editable]);

  const upload = async (out: Edited, as: "version" | "copy", name: string) => {
    await uploadFile(
      api.account,
      parentId,
      name,
      out.uri,
      out.size,
      out.mime,
      as,
    );
    snack({
      text: as === "copy" ? "Saved as a copy." : "Saving a new version…",
    });
    router.back();
  };
  const finish = async (out: Edited, as: "primary" | "secondary") => {
    const mode = as === "primary" ? "version" : "copy";
    if (!isOnline()) {
      snack({
        text: "You're offline. Edited photos can't be saved until you're back online.",
        error: true,
      });
      return false;
    }
    try {
      const now = (await currentOf(api.account, id)).item;
      if (!now || now.trashedAt)
        throw new Error(
          "This photo is in the trash or gone, so it can't be saved.",
        );
      if (
        mode === "version" &&
        parentId === null &&
        details.data?.details.role !== "owner"
      )
        throw new Error(
          "A new version can't be saved from here. Use Save as copy.",
        );
      if (
        mode === "version" &&
        opened.current !== null &&
        changedSince(opened.current, now.version)
      ) {
        held.current = out;
        setAsk(true);
        return false;
      }
      await upload(out, mode, now.name);
      return true;
    } catch (e) {
      snack({
        text:
          e instanceof Error && !(e instanceof ApiError)
            ? e.message
            : errorText(e),
        error: true,
      });
      return false;
    }
  };

  if (failed)
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Bar>
          <IconButton
            icon={X}
            label="Close editor"
            onPress={() => router.back()}
          />
        </Bar>
        <Text color={c.destructive} style={{ padding: 24 }}>
          {failed}
        </Text>
      </View>
    );
  if (!src)
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Bar>
          <IconButton
            icon={X}
            label="Close editor"
            onPress={() => router.back()}
          />
        </Bar>
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator
            color={c.mutedForeground}
            accessibilityLabel="Loading"
          />
        </View>
      </View>
    );
  return (
    <>
      <Editor
        source={src}
        primary="Save"
        secondary="Save as copy"
        onFinish={finish}
        onLeave={() => router.back()}
      />
      {ask && (
        <Frame title="Changed on the server" onClose={() => setAsk(false)}>
          <Text color={c.mutedForeground}>
            {CHANGED} Saving over it would replace the newer edit.
          </Text>
          <Actions>
            <Button
              variant="text"
              danger
              label="Discard mine"
              onPress={() => router.back()}
            />
            <Button
              variant="text"
              label="Keep both"
              onPress={async () => {
                setAsk(false);
                try {
                  if (held.current)
                    await upload(held.current, "copy", item!.name);
                } catch (e) {
                  snack({ text: errorText(e), error: true });
                }
              }}
            />
          </Actions>
        </Frame>
      )}
    </>
  );
}

// ---- The editor ----

function Editor({
  source,
  primary,
  secondary,
  onFinish,
  onLeave,
}: {
  source: Source;
  primary: string;
  secondary: string;
  // Gets the edited file; true when it's been dealt with.
  onFinish: (out: Edited, as: "primary" | "secondary") => Promise<boolean>;
  onLeave: () => void;
}) {
  const snack = useSnack();
  const inset = useSafeAreaInsets();
  const format = outFormat(source.mime);
  const [prev, setPrev] = useState<Size | null>(null);
  const [geo, setGeo] = useState<Geo>(START);
  const [mode, setMode] = useState<"crop" | "markup">("crop");
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(COLORS[0][1]);
  const [ops, setOps] = useState<Op[]>([]);
  const [undone, setUndone] = useState<Op[]>([]);
  const [draft, setDraft] = useState<Op | null>(null);
  const [typing, setTyping] = useState<Pt | null>(null);
  const [flat, setFlat] = useState<Size | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState<"primary" | "secondary" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const after = useRef<"primary" | "secondary" | null>(null);
  const frame = useRef<ComponentRef<typeof View>>(null);

  // A smaller copy to work on, so dragging stays smooth; the full picture is only read when saving.
  useEffect(() => {
    let live = true;
    (async () => {
      const ref = await ImageManipulator.manipulate(source.uri, {
        maxWidth: PREVIEW_SIDE,
        maxHeight: PREVIEW_SIDE,
      }).renderAsync();
      const saved = await ref.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.9,
      });
      if (live) setPrev(saved);
    })().catch(
      () =>
        live &&
        snack({ text: "Couldn't open this photo for editing.", error: true }),
    );
    return () => {
      live = false;
    };
  }, [source.uri, snack]);

  const dirty = !same(geo, START) || ops.length > 0;
  const odd = geo.quarter % 2 === 1;
  const W = prev ? (odd ? prev.height : prev.width) : 1;
  const H = prev ? (odd ? prev.width : prev.height) : 1;
  const inner = innerSize(W, H, geo.angle);
  const ratio = inner.w / inner.h;

  // Geometry changes redraw the picture, so the crop box and the markup start over.
  const change = (next: Partial<Geo>) => {
    setGeo((g) => {
      const n = { ...g, ...next };
      if (!("crop" in next)) {
        const odd = n.quarter % 2 === 1;
        const r = prev
          ? innerSize(
              odd ? prev.height : prev.width,
              odd ? prev.width : prev.height,
              n.angle,
            )
          : { w: 1, h: 1 };
        n.crop = n.aspect ? fitAspect(n.aspect, r.w / r.h) : FULL;
      }
      return n;
    });
    setFlat(null);
    if (!("crop" in next) || ops.length) {
      setOps([]);
      setUndone([]);
    }
  };
  const pickAspect = (a: number | null) => {
    // Tapping the chosen shape again turns it sideways.
    const next = a !== null && a !== 1 && geo.aspect === a ? 1 / a : a;
    change({ aspect: next, crop: next ? fitAspect(next, ratio) : geo.crop });
  };

  // Geometry on the full picture: turns and flip, then the tilt, then the crop.
  const render = useCallback(async (): Promise<Size> => {
    const first = ImageManipulator.manipulate(source.uri, LIMIT);
    if (geo.quarter) first.rotate(geo.quarter * 90);
    if (geo.flip) first.flip("horizontal");
    const a = await first.renderAsync();
    const b = geo.angle
      ? await ImageManipulator.manipulate(a).rotate(geo.angle).renderAsync()
      : a;
    const box = cropBox(a.width, a.height, b.width, b.height, geo);
    const whole = box.width >= b.width && box.height >= b.height;
    const out = whole
      ? b
      : await ImageManipulator.manipulate(b).crop(box).renderAsync();
    return out.saveAsync({ format: FORMAT[format], compress: 0.92 });
  }, [source.uri, geo, format]);

  // Markup is drawn on the result of the geometry, so it's made when the tab opens.
  useEffect(() => {
    if (mode !== "markup" || flat) return;
    let live = true;
    render().then(
      (r) => live && setFlat(r),
      () =>
        live &&
        snack({ text: "Couldn't prepare the photo for markup.", error: true }),
    );
    return () => {
      live = false;
    };
  }, [mode, flat, render, snack]);

  // The EXIF date and GPS of the original go into an edited JPEG.
  const produce = useCallback(async (): Promise<Edited> => {
    let out: Size;
    if (ops.length && flat) {
      const size = flatSize(flat.width, flat.height);
      const uri = await captureRef(frame, {
        format: SHOT_FORMAT[format],
        quality: 0.92,
        result: "tmpfile",
        ...size,
      });
      out = { uri, ...size };
    } else out = await render();
    const file = new File(out.uri);
    if (format === "jpeg") {
      // A shared-in content:// file may not be readable as bytes; then it simply carries no date or GPS over.
      const meta = await new File(source.uri)
        .bytes()
        .then(readExif, () => ({}) as ReturnType<typeof readExif>);
      await file.write(
        withExif(await file.bytes(), {
          takenAt: meta.takenAt ?? source.takenAt,
          gps: meta.gps,
        }),
      );
    }
    return { uri: out.uri, size: file.size ?? 0, mime: `image/${format}` };
  }, [ops.length, flat, render, format, source]);

  const save = useCallback(
    async (as: "primary" | "secondary") => {
      if (busy) return;
      setBusy(as);
      try {
        await onFinish(await produce(), as);
      } catch (e) {
        snack({
          text: "Couldn't save the edited photo. Try again.",
          error: true,
        });
        console.warn(e);
      } finally {
        setBusy(null);
      }
    },
    [busy, onFinish, produce, snack],
  );
  // With markup in place, saving from the Crop tab goes through the Markup tab, whose frame is what gets flattened.
  const start = (as: "primary" | "secondary") => {
    if (ops.length && mode !== "markup") {
      after.current = as;
      return setMode("markup");
    }
    save(as);
  };
  useEffect(() => {
    const as = after.current;
    if (as && mode === "markup" && flat) {
      after.current = null;
      save(as);
    }
  }, [mode, flat, save]);

  const back = useCallback(
    () => (dirty && !busy ? setLeaving(true) : onLeave()),
    [dirty, busy, onLeave],
  );
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        back();
        return true;
      });
      return () => sub.remove();
    }, [back]),
  );

  // The picture's size on screen: the whole straightened picture to crop, or the finished crop to mark up.
  const shownW = mode === "crop" ? inner.w : flat ? flat.width : 1;
  const shownH = mode === "crop" ? inner.h : flat ? flat.height : 1;
  const k = Math.min((stage.w - 24) / shownW, (stage.h - 24) / shownH);
  const vw = stage.w && stage.h && k > 0 ? Math.floor(shownW * k) : 0;
  const vh = stage.w && stage.h && k > 0 ? Math.floor(shownH * k) : 0;
  const loading = !prev || (mode === "markup" && !flat);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <Bar>
        <IconButton icon={X} label="Close editor" onPress={back} />
        <View style={{ flex: 1 }}>
          <Text
            variant="titleSmall"
            numberOfLines={1}
            accessibilityRole="header"
          >
            {source.name}
          </Text>
          <Text variant="caption" color={c.mutedForeground}>
            {dirty ? "Edited" : "No changes yet"}
          </Text>
        </View>
        {mode === "markup" && (
          <>
            <IconButton
              icon={ArrowUUpLeft}
              label="Undo"
              color={ops.length ? c.foreground : c.mutedForeground}
              onPress={() => {
                const last = ops[ops.length - 1];
                if (!last) return;
                setOps(ops.slice(0, -1));
                setUndone([last, ...undone]);
              }}
            />
            <IconButton
              icon={ArrowUUpRight}
              label="Redo"
              color={undone.length ? c.foreground : c.mutedForeground}
              onPress={() => {
                if (!undone.length) return;
                setOps([...ops, undone[0]]);
                setUndone(undone.slice(1));
              }}
            />
          </>
        )}
      </Bar>

      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000",
        }}
        onLayout={(e) =>
          setStage({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
      >
        {loading && (
          <ActivityIndicator
            color={c.mutedForeground}
            accessibilityLabel="Loading"
          />
        )}
        {!loading && vw > 0 && prev && (
          // The crop box sits outside the clipped frame so its handles can hang over the edges.
          <View style={{ width: vw, height: vh }}>
            <View
              ref={frame}
              collapsable={false}
              style={{
                width: vw,
                height: vh,
                overflow: "hidden",
                backgroundColor: "#000",
              }}
            >
              {mode === "crop" ? (
                <>
                  {/* The straightened picture, clipped to its largest inner rectangle: the same geometry the manipulator applies. */}
                  <View
                    style={{
                      position: "absolute",
                      width: W * k,
                      height: H * k,
                      left: -((W - inner.w) / 2) * k,
                      top: -((H - inner.h) / 2) * k,
                    }}
                  >
                    <Image
                      source={{ uri: prev.uri }}
                      accessibilityLabel="Photo being edited"
                      style={{
                        position: "absolute",
                        width: prev.width * k,
                        height: prev.height * k,
                        left: ((W - prev.width) / 2) * k,
                        top: ((H - prev.height) / 2) * k,
                        transform: [
                          { rotate: `${geo.angle}deg` },
                          { scaleX: geo.flip ? -1 : 1 },
                          { rotate: `${geo.quarter * 90}deg` },
                        ],
                      }}
                    />
                  </View>
                </>
              ) : (
                flat && (
                  <>
                    <Image
                      source={{ uri: flat.uri }}
                      accessibilityLabel="Photo being marked up"
                      style={{ width: vw, height: vh }}
                    />
                    <Markup
                      ops={draft ? [...ops, draft] : ops}
                      vw={vw}
                      vh={vh}
                      tool={tool}
                      color={color}
                      typing={typing}
                      onDraft={setDraft}
                      onCommit={(op) => {
                        setOps((o) => [...o, op]);
                        setUndone([]);
                      }}
                      onType={setTyping}
                    />
                  </>
                )
              )}
            </View>
            {mode === "crop" && (
              <CropBox
                rect={geo.crop}
                aspect={geo.aspect}
                ratio={ratio}
                vw={vw}
                vh={vh}
                onChange={(crop) => change({ crop })}
              />
            )}
          </View>
        )}
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: "row",
            gap: 8,
            paddingHorizontal: 12,
            paddingTop: 8,
          }}
        >
          {(
            [
              ["crop", "Crop", Crop],
              ["markup", "Markup", PencilSimpleLine],
            ] as const
          ).map(([m, label, Icon]) => (
            <Pressable
              key={m}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: mode === m }}
              onPress={() => {
                setMode(m);
                setTyping(null);
              }}
              android_ripple={{ color: c.ripple }}
              style={{
                minHeight: 44,
                paddingHorizontal: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                borderRadius: radius.pill,
                backgroundColor: mode === m ? c.muted : "transparent",
              }}
            >
              <Icon
                size={20}
                color={mode === m ? c.foreground : c.mutedForeground}
              />
              <Text
                variant="label"
                color={mode === m ? c.foreground : c.mutedForeground}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {mode === "crop" ? (
          <View style={{ paddingVertical: 8, gap: 4 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                alignItems: "center",
                paddingHorizontal: 12,
                gap: 4,
              }}
            >
              {ASPECTS.map(([label, a]) => {
                const on =
                  geo.aspect !== null && a !== null
                    ? geo.aspect === a || geo.aspect === 1 / a
                    : geo.aspect === a;
                const text =
                  on && a !== null && a !== 1 && geo.aspect !== a
                    ? label.split(":").reverse().join(":")
                    : label;
                return (
                  <Pressable
                    key={label}
                    accessibilityRole="button"
                    accessibilityLabel={`Crop ${text}`}
                    accessibilityState={{ selected: on }}
                    onPress={() => pickAspect(a)}
                    android_ripple={{ color: c.ripple }}
                    style={{
                      minHeight: 44,
                      minWidth: 56,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 12,
                      borderRadius: radius.pill,
                      backgroundColor: on ? c.muted : "transparent",
                    }}
                  >
                    <Text
                      variant="label"
                      color={on ? c.foreground : c.mutedForeground}
                    >
                      {text}
                    </Text>
                  </Pressable>
                );
              })}
              <IconButton
                icon={ArrowCounterClockwise}
                label="Rotate left"
                onPress={() => change({ quarter: (geo.quarter + 3) % 4 })}
              />
              <IconButton
                icon={ArrowClockwise}
                label="Rotate right"
                onPress={() => change({ quarter: (geo.quarter + 1) % 4 })}
              />
              <IconButton
                icon={FlipHorizontal}
                label="Flip horizontally"
                color={geo.flip ? c.brand : c.foreground}
                onPress={() => change({ flip: !geo.flip })}
              />
            </ScrollView>
            <Straighten
              angle={geo.angle}
              onChange={(angle) => change({ angle })}
            />
            {ops.length > 0 && (
              <Text
                variant="caption"
                color={c.mutedForeground}
                style={{ paddingHorizontal: 16 }}
              >
                Changing the crop clears your markup.
              </Text>
            )}
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              alignItems: "center",
              paddingHorizontal: 12,
              paddingVertical: 8,
              gap: 4,
            }}
          >
            {TOOLS.map(([t, label, Icon]) => (
              <View
                key={t}
                style={{
                  borderRadius: 24,
                  overflow: "hidden",
                  backgroundColor: tool === t ? c.muted : "transparent",
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: tool === t }}
                  onPress={() => setTool(t)}
                  android_ripple={{ color: c.ripple }}
                  style={{
                    width: 48,
                    height: 48,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon
                    size={24}
                    color={tool === t ? c.foreground : c.mutedForeground}
                  />
                </Pressable>
              </View>
            ))}
            <View
              style={{
                width: 1,
                height: 28,
                backgroundColor: c.border,
                marginHorizontal: 8,
              }}
            />
            {COLORS.map(([label, hex]) => (
              <Pressable
                key={hex}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ checked: color === hex }}
                onPress={() => setColor(hex)}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: hex,
                    borderWidth: color === hex ? 3 : 1,
                    borderColor:
                      color === hex ? c.brand : "rgba(255,255,255,0.3)",
                  }}
                />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View
          style={{
            flexDirection: "row",
            gap: 8,
            padding: 12,
            paddingBottom: inset.bottom + 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Button
              variant="outlined"
              label={secondary}
              busy={busy === "secondary"}
              disabled={!prev || (secondary === "Save as copy" && !dirty)}
              onPress={() => start("secondary")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={primary}
              busy={busy === "primary"}
              disabled={!prev || !dirty}
              onPress={() => start("primary")}
            />
          </View>
        </View>
      </View>

      {leaving && (
        <Frame title="Discard your edits?" onClose={() => setLeaving(false)}>
          <Text color={c.mutedForeground}>
            Your edits to “{source.name}” have not been saved.
          </Text>
          <Actions>
            <Button
              variant="text"
              label="Keep editing"
              onPress={() => setLeaving(false)}
            />
            <Button variant="text" danger label="Discard" onPress={onLeave} />
          </Actions>
        </Frame>
      )}
    </KeyboardAvoidingView>
  );
}

// The newest props for a PanResponder, which is made once.
function useLatest<T>(value: T) {
  const box = useRef({ value });
  useEffect(() => {
    box.current.value = value;
  });
  // The holder itself never changes, only its value, which is read in gesture callbacks, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  return box.current;
}

// ---- Crop box ----

// Where each handle sits on the box, as fractions of its width and height.
const GRABS: [Handle, string, [number, number]][] = [
  ["nw", "top left", [0, 0]],
  ["n", "top", [0.5, 0]],
  ["ne", "top right", [1, 0]],
  ["e", "right", [1, 0.5]],
  ["se", "bottom right", [1, 1]],
  ["s", "bottom", [0.5, 1]],
  ["sw", "bottom left", [0, 1]],
  ["w", "left", [0, 0.5]],
];
const STEPS = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
} as const;

function CropBox({
  rect,
  aspect,
  ratio,
  vw,
  vh,
  onChange,
}: {
  rect: Rect;
  aspect: number | null;
  ratio: number;
  vw: number;
  vh: number;
  onChange: (r: Rect) => void;
}) {
  const left = rect.x * vw;
  const top = rect.y * vh;
  const width = rect.w * vw;
  const height = rect.h * vh;
  const live = { rect, aspect, ratio, vw, vh, onChange };
  return (
    <>
      {/* Shade outside the box. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          height: top,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: top + height,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top,
          width: left,
          height,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: left + width,
          top,
          right: 0,
          height,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      />
      <Grab
        handle="move"
        label="Crop area"
        live={live}
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.9)",
        }}
      >
        {[1, 2].map((i) => (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: (width * i) / 3,
              top: 0,
              bottom: 0,
              width: 1,
              backgroundColor: "rgba(255,255,255,0.35)",
            }}
          />
        ))}
        {[1, 2].map((i) => (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: "absolute",
              top: (height * i) / 3,
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: "rgba(255,255,255,0.35)",
            }}
          />
        ))}
      </Grab>
      {GRABS.filter(([h]) => !aspect || h.length === 2).map(
        ([h, name, [fx, fy]]) => (
          <View
            key={h}
            pointerEvents="box-none"
            style={{ position: "absolute", left, top, width, height }}
          >
            <Grab
              handle={h}
              label={`Resize crop, ${name}`}
              live={live}
              style={{
                position: "absolute",
                width: 44,
                height: 44,
                left: fx * width - 22,
                top: fy * height - 22,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                pointerEvents="none"
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 6,
                  width: h.length === 2 ? 14 : h === "n" || h === "s" ? 28 : 6,
                  height: h.length === 2 ? 14 : h === "n" || h === "s" ? 6 : 28,
                }}
              />
            </Grab>
          </View>
        ),
      )}
    </>
  );
}

// One draggable part of the crop box. Screen readers move it in steps.
function Grab({
  handle,
  label,
  live,
  style,
  children,
}: {
  handle: Handle;
  label: string;
  live: {
    rect: Rect;
    aspect: number | null;
    ratio: number;
    vw: number;
    vh: number;
    onChange: (r: Rect) => void;
  };
  style: object;
  children?: React.ReactNode;
}) {
  const latest = useLatest(live);
  const [from] = useState(() => ({ rect: live.rect }));
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        from.rect = latest.value.rect;
      },
      onPanResponderMove: (_, g) => {
        const l = latest.value;
        l.onChange(
          dragCrop(
            from.rect,
            handle,
            g.dx / l.vw,
            g.dy / l.vh,
            l.ratio,
            l.aspect,
          ),
        );
      },
    }),
  );
  return (
    <View
      {...pan.panHandlers}
      accessible
      accessibilityLabel={label}
      accessibilityActions={(Object.keys(STEPS) as (keyof typeof STEPS)[]).map(
        (name) => ({ name, label: `Move ${name}` }),
      )}
      onAccessibilityAction={(e) => {
        const s = STEPS[e.nativeEvent.actionName as keyof typeof STEPS];
        if (s)
          live.onChange(
            dragCrop(
              live.rect,
              handle,
              s[0] * 0.02,
              s[1] * 0.02,
              live.ratio,
              live.aspect,
            ),
          );
      }}
      style={style as never}
    >
      {children}
    </View>
  );
}

// ---- Straighten ----

function Straighten({
  angle,
  onChange,
}: {
  angle: number;
  onChange: (a: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const live = useLatest({ width, onChange });
  const [pan] = useState(() => {
    const at = (x: number) =>
      Math.round(
        (Math.min(1, Math.max(0, x / (live.value.width || 1))) - 0.5) *
          2 *
          MAX_ANGLE *
          2,
      ) / 2;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) =>
        live.value.onChange(at(e.nativeEvent.locationX)),
      onPanResponderMove: (e) =>
        live.value.onChange(at(e.nativeEvent.locationX)),
    });
  });
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
      }}
    >
      <Text variant="label" color={c.mutedForeground}>
        Straighten
      </Text>
      <View
        {...pan.panHandlers}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Straighten"
        accessibilityValue={{
          min: -MAX_ANGLE,
          max: MAX_ANGLE,
          now: angle,
          text: `${angle} degrees`,
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) =>
          onChange(
            Math.max(
              -MAX_ANGLE,
              Math.min(
                MAX_ANGLE,
                angle + (e.nativeEvent.actionName === "increment" ? 1 : -1),
              ),
            ),
          )
        }
        style={{ flex: 1, height: 44, justifyContent: "center" }}
      >
        <View
          pointerEvents="none"
          style={{ height: 4, borderRadius: 2, backgroundColor: c.mutedStrong }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: "50%",
            width: 2,
            height: 12,
            marginLeft: -1,
            backgroundColor: c.dim,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: `${((angle + MAX_ANGLE) / (2 * MAX_ANGLE)) * 100}%`,
            width: 20,
            height: 20,
            marginLeft: -10,
            borderRadius: 10,
            backgroundColor: c.brand,
          }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset straighten"
        onPress={() => onChange(0)}
        style={{
          minWidth: 48,
          minHeight: 44,
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>
          {angle}°
        </Text>
      </Pressable>
    </View>
  );
}

// ---- Markup ----

const dots = (pts: Pt[], vw: number, vh: number) => {
  const [x, y] = pts[0];
  const d = pts
    .map(([px, py], i) => `${i ? "L" : "M"}${px * vw} ${py * vh}`)
    .join(" ");
  return pts.length === 1 ? `${d} L${x * vw + 0.01} ${y * vh}` : d;
};

function Markup({
  ops,
  vw,
  vh,
  tool,
  color,
  typing,
  onDraft,
  onCommit,
  onType,
}: {
  ops: Op[];
  vw: number;
  vh: number;
  tool: Tool;
  color: string;
  typing: Pt | null;
  onDraft: (op: Op | null) => void;
  onCommit: (op: Op) => void;
  onType: (at: Pt | null) => void;
}) {
  const unit = Math.min(vw, vh);
  const [text, setText] = useState("");
  const latest = useLatest({
    tool,
    color,
    vw,
    vh,
    typing,
    onDraft,
    onCommit,
    onType,
  });
  const [drag] = useState<{ op: Op | null; origin: Pt }>({
    op: null,
    origin: [0, 0],
  });
  const norm = (x: number, y: number): Pt => {
    const l = latest.value;
    return [
      Math.min(1, Math.max(0, x / l.vw)),
      Math.min(1, Math.max(0, y / l.vh)),
    ];
  };
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const l = latest.value;
        drag.origin = [e.nativeEvent.locationX, e.nativeEvent.locationY];
        if (l.typing) return;
        const p = norm(...drag.origin);
        drag.op =
          l.tool === "text"
            ? null
            : l.tool === "arrow"
              ? { kind: "arrow", color: l.color, w: WIDTH.arrow, a: p, b: p }
              : { kind: l.tool, color: l.color, w: WIDTH[l.tool], pts: [p] };
        l.onDraft(drag.op);
      },
      onPanResponderMove: (_, g) => {
        const cur = drag.op;
        if (!cur) return;
        const p = norm(drag.origin[0] + g.dx, drag.origin[1] + g.dy);
        drag.op =
          cur.kind === "arrow"
            ? { ...cur, b: p }
            : cur.kind === "text"
              ? cur
              : { ...cur, pts: [...cur.pts, p] };
        latest.value.onDraft(drag.op);
      },
      onPanResponderRelease: (_, g) => {
        const l = latest.value;
        const cur = drag.op;
        drag.op = null;
        l.onDraft(null);
        if (l.typing) return l.onType(null);
        if (l.tool === "text")
          return void (
            Math.hypot(g.dx, g.dy) < 10 &&
            (setText(""), l.onType(norm(...drag.origin)))
          );
        if (!cur) return;
        const tiny =
          cur.kind === "arrow" &&
          Math.hypot(
            (cur.b[0] - cur.a[0]) * l.vw,
            (cur.b[1] - cur.a[1]) * l.vh,
          ) < 8;
        if (!tiny) l.onCommit(cur);
      },
      onPanResponderTerminate: () => {
        drag.op = null;
        latest.value.onDraft(null);
      },
    }),
  );
  const place = () => {
    const l = latest.value;
    if (l.typing && text.trim())
      l.onCommit({
        kind: "text",
        color: l.color,
        size: WIDTH.text,
        at: l.typing,
        text,
      });
    l.onType(null);
  };
  return (
    <View
      {...pan.panHandlers}
      style={{ position: "absolute", left: 0, top: 0, width: vw, height: vh }}
      accessible
      accessibilityLabel={`Draw with ${tool}`}
    >
      <Svg width={vw} height={vh} pointerEvents="none">
        {ops.map((o, i) => {
          if (o.kind === "text")
            return (
              <SvgText
                key={i}
                x={o.at[0] * vw}
                y={o.at[1] * vh + o.size * unit * 0.85}
                fontSize={o.size * unit}
                fontWeight="600"
                fill={o.color}
              >
                {o.text}
              </SvgText>
            );
          if (o.kind === "arrow") {
            const [ax, ay, bx, by] = [
              o.a[0] * vw,
              o.a[1] * vh,
              o.b[0] * vw,
              o.b[1] * vh,
            ];
            const turn = Math.atan2(by - ay, bx - ax);
            const head = Math.min(
              o.w * unit * 5,
              Math.hypot(bx - ax, by - ay) / 2,
            );
            const tip = (s: number) =>
              `${bx - head * Math.cos(turn - s * 0.45)},${by - head * Math.sin(turn - s * 0.45)}`;
            return (
              <Fragment key={i}>
                <Path
                  d={`M${ax} ${ay} L${bx - Math.cos(turn) * head * 0.6} ${by - Math.sin(turn) * head * 0.6}`}
                  stroke={o.color}
                  strokeWidth={o.w * unit}
                  strokeLinecap="round"
                />
                <Polygon
                  points={`${bx},${by} ${tip(-1)} ${tip(1)}`}
                  fill={o.color}
                />
              </Fragment>
            );
          }
          return (
            <Path
              key={i}
              d={dots(o.pts, vw, vh)}
              stroke={o.color}
              strokeOpacity={o.kind === "highlighter" ? 0.35 : 1}
              strokeWidth={o.w * unit}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          );
        })}
      </Svg>
      {typing && (
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={place}
          onBlur={place}
          autoFocus
          accessibilityLabel="Text to add"
          selectionColor={c.brand}
          style={{
            position: "absolute",
            left: typing[0] * vw,
            top: typing[1] * vh,
            minWidth: 96,
            padding: 0,
            color,
            fontSize: WIDTH.text * unit,
            fontWeight: "600",
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: "rgba(255,255,255,0.6)",
          }}
        />
      )}
    </View>
  );
}
