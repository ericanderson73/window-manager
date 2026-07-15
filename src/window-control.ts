import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export enum WindowAdjustment {
	MoveHorizontal,
	MoveVertical,
	ResizeHorizontal,
	ResizeVertical,
}

export type WindowBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/**
 * Applies a signed pixel adjustment and returns the window geometry from before
 * the adjustment. The caller can use it as a one-press restore point.
 */
export async function adjustFocusedWindow(adjustment: WindowAdjustment, distance: number): Promise<WindowBounds> {
	if (!Number.isFinite(distance) || distance === 0) throw new Error("A non-zero adjustment distance is required.");

	const [moveX, moveY, resizeX, resizeY] = adjustmentVector(adjustment, Math.round(distance));
	if (process.platform === "darwin") {
		// `--` keeps negative counter-clockwise values (for example, -20) from
		// being parsed by osascript as command-line options.
		const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", macScript, "--", String(moveX), String(moveY), String(resizeX), String(resizeY)]);
		return parseWindowBounds(stdout);
	}

	if (process.platform === "win32") {
		const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsScript, String(moveX), String(moveY), String(resizeX), String(resizeY)]);
		return parseWindowBounds(stdout);
	}

	throw new Error(`Window adjustment is not supported on ${process.platform}.`);
}

/** Moves the focused window to another monitor and returns its original geometry. */
export async function moveFocusedWindowToAdjacentMonitor(direction: number): Promise<WindowBounds> {
	const normalizedDirection = Math.sign(direction);
	if (normalizedDirection === 0) throw new Error("A non-zero monitor direction is required.");

	if (process.platform === "darwin") {
		const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", moveMonitorMacScript, "--", String(normalizedDirection)]);
		return parseWindowBounds(stdout);
	}

	if (process.platform === "win32") {
		const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", moveMonitorWindowsScript, String(normalizedDirection)]);
		return parseWindowBounds(stdout);
	}

	throw new Error(`Moving a window between monitors is not supported on ${process.platform}.`);
}

/** Snaps the focused window to one indexed segment of its current monitor. */
export async function snapFocusedWindowToScreenSegment(segment: number, fraction: number): Promise<WindowBounds> {
	if (!Number.isInteger(fraction) || fraction < 2) throw new Error("A screen fraction of at least 2 is required.");
	if (!Number.isInteger(segment) || segment < 0 || segment >= fraction) throw new Error("The requested screen segment is invalid.");

	if (process.platform === "darwin") {
		const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", snapWindowMacScript, "--", String(segment), String(fraction)]);
		return parseWindowBounds(stdout);
	}

	if (process.platform === "win32") {
		const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", snapWindowWindowsScript, String(segment), String(fraction)]);
		return parseWindowBounds(stdout);
	}

	throw new Error(`Window snapping is not supported on ${process.platform}.`);
}

/** Restores the focused window to previously captured coordinates and size. */
export async function restoreFocusedWindowBounds(bounds: WindowBounds): Promise<void> {
	if (process.platform === "darwin") {
		await execFileAsync("/usr/bin/osascript", ["-e", restoreWindowMacScript, "--", String(bounds.x), String(bounds.y), String(bounds.width), String(bounds.height)]);
		return;
	}

	if (process.platform === "win32") {
		await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", restoreWindowWindowsScript, String(bounds.x), String(bounds.y), String(bounds.width), String(bounds.height)]);
		return;
	}

	throw new Error(`Window restoration is not supported on ${process.platform}.`);
}

function parseWindowBounds(output: string | Buffer): WindowBounds {
	const parsed: unknown = JSON.parse(String(output).trim());
	if (!parsed || typeof parsed !== "object") throw new Error("Unable to read the focused window bounds.");

	const { x, y, width, height } = parsed as Record<string, unknown>;
	if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
		throw new Error("The focused window returned invalid bounds.");
	}

	return { x, y, width, height };
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function adjustmentVector(adjustment: WindowAdjustment, distance: number): [number, number, number, number] {
	const centeredEdgeOffset = -Math.trunc(distance / 2);
	switch (adjustment) {
		case WindowAdjustment.MoveHorizontal: return [distance, 0, 0, 0];
		case WindowAdjustment.MoveVertical: return [0, distance, 0, 0];
		// Resize from the centre: adjust the leading edge through the position,
		// while the new size moves the trailing edge by the same amount.
		case WindowAdjustment.ResizeHorizontal: return [centeredEdgeOffset, 0, distance, 0];
		case WindowAdjustment.ResizeVertical: return [0, centeredEdgeOffset, 0, distance];
	}
}

const macScript = `on run argv
	set moveX to (item 1 of argv) as integer
	set moveY to (item 2 of argv) as integer
	set resizeX to (item 3 of argv) as integer
	set resizeY to (item 4 of argv) as integer
	tell application "System Events"
		set frontApp to first application process whose frontmost is true
		tell window 1 of frontApp
			set {windowX, windowY} to position
			set {windowWidth, windowHeight} to size
			set originalBounds to "{\\\"x\\\":" & windowX & ",\\\"y\\\":" & windowY & ",\\\"width\\\":" & windowWidth & ",\\\"height\\\":" & windowHeight & "}"
			set newWidth to windowWidth + resizeX
			set newHeight to windowHeight + resizeY
			if newWidth < 1 then set newWidth to 1
			if newHeight < 1 then set newHeight to 1
			set position to {windowX + moveX, windowY + moveY}
			set size to {newWidth, newHeight}
		end tell
	end tell
	return originalBounds
end run`;

const windowsScript = `
$moveX = [int]$args[0]; $moveY = [int]$args[1]; $resizeX = [int]$args[2]; $resizeY = [int]$args[3]
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WindowControl {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
}
'@
$window = [WindowControl]::GetForegroundWindow(); $rect = New-Object WindowControl+RECT
if ($window -eq [IntPtr]::Zero -or -not [WindowControl]::GetWindowRect($window, [ref]$rect)) { throw "No focused window found." }
$width = [Math]::Max(1, $rect.Right - $rect.Left + $resizeX); $height = [Math]::Max(1, $rect.Bottom - $rect.Top + $resizeY)
if (-not [WindowControl]::MoveWindow($window, $rect.Left + $moveX, $rect.Top + $moveY, $width, $height, $true)) { throw "Unable to adjust focused window." }
@{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress
`;

const moveMonitorMacScript = `
ObjC.import('AppKit');

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function run(argv) {
  const direction = Number(argv[0]);
  const systemEvents = Application('System Events');
  const application = systemEvents.applicationProcesses.whose({ frontmost: true })()[0];
  const window = application.windows[0];
  const [windowX, windowY] = window.position();
  const [windowWidth, windowHeight] = window.size();
	const originalBounds = { x: Number(windowX), y: Number(windowY), width: Number(windowWidth), height: Number(windowHeight) };

  const screens = [];
  const nsScreens = $.NSScreen.screens;
  for (let index = 0; index < nsScreens.count; index++) {
    const frame = nsScreens.objectAtIndex(index).frame;
    screens.push({ x: Number(frame.origin.x), y: Number(frame.origin.y), width: Number(frame.size.width), height: Number(frame.size.height) });
  }
  if (screens.length < 2) return JSON.stringify(originalBounds);

  const virtualTop = Math.max(...screens.map((screen) => screen.y + screen.height));
  const centerX = windowX + windowWidth / 2;
  const centerY = virtualTop - (windowY + windowHeight / 2);
  const orderedScreens = screens.sort((a, b) => a.x - b.x || a.y - b.y);
  const sourceIndex = orderedScreens.findIndex((screen) =>
    centerX >= screen.x && centerX <= screen.x + screen.width &&
    centerY >= screen.y && centerY <= screen.y + screen.height);
  const source = orderedScreens[sourceIndex >= 0 ? sourceIndex : 0];
  const targetIndex = (orderedScreens.indexOf(source) + direction + orderedScreens.length) % orderedScreens.length;
  const target = orderedScreens[targetIndex];

  const relativeX = clamp((centerX - source.x) / source.width, 0, 1);
  const relativeY = clamp((centerY - source.y) / source.height, 0, 1);
  const targetX = clamp(target.x + relativeX * target.width - windowWidth / 2, target.x, target.x + Math.max(0, target.width - windowWidth));
  const targetY = clamp(target.y + relativeY * target.height - windowHeight / 2, target.y, target.y + Math.max(0, target.height - windowHeight));
  window.position = [Math.round(targetX), Math.round(virtualTop - targetY - windowHeight)];
	return JSON.stringify(originalBounds);
}
`;

const moveMonitorWindowsScript = `
$direction = [Math]::Sign([int]$args[0])
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class MonitorControl {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public int dwFlags; }
  public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, IntPtr lprcMonitor, IntPtr dwData);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO monitorInfo);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
  public static List<Tuple<IntPtr, RECT>> GetMonitors() {
    var monitors = new List<Tuple<IntPtr, RECT>>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (handle, hdc, rect, data) => { var info = new MONITORINFO(); info.cbSize = Marshal.SizeOf(info); GetMonitorInfo(handle, ref info); monitors.Add(Tuple.Create(handle, info.rcWork)); return true; }, IntPtr.Zero);
    return monitors;
  }
}
'@
$window = [MonitorControl]::GetForegroundWindow(); $rect = New-Object MonitorControl+RECT
if ($window -eq [IntPtr]::Zero -or -not [MonitorControl]::GetWindowRect($window, [ref]$rect)) { throw "No focused window found." }
$monitors = [MonitorControl]::GetMonitors() | Sort-Object { $_.Item2.Left }, { $_.Item2.Top }
if ($monitors.Count -lt 2) { @{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress; return }
$sourceHandle = [MonitorControl]::MonitorFromWindow($window, 2); $sourceIndex = 0
for ($i = 0; $i -lt $monitors.Count; $i++) { if ($monitors[$i].Item1 -eq $sourceHandle) { $sourceIndex = $i; break } }
$target = $monitors[(($sourceIndex + $direction + $monitors.Count) % $monitors.Count)].Item2; $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
$relativeX = (($rect.Left + $width / 2) - $monitors[$sourceIndex].Item2.Left) / [Math]::Max(1, $monitors[$sourceIndex].Item2.Right - $monitors[$sourceIndex].Item2.Left)
$relativeY = (($rect.Top + $height / 2) - $monitors[$sourceIndex].Item2.Top) / [Math]::Max(1, $monitors[$sourceIndex].Item2.Bottom - $monitors[$sourceIndex].Item2.Top)
$x = [Math]::Max($target.Left, [Math]::Min($target.Right - $width, $target.Left + $relativeX * ($target.Right - $target.Left) - $width / 2)); $y = [Math]::Max($target.Top, [Math]::Min($target.Bottom - $height, $target.Top + $relativeY * ($target.Bottom - $target.Top) - $height / 2))
if (-not [MonitorControl]::MoveWindow($window, [int]$x, [int]$y, $width, $height, $true)) { throw "Unable to move focused window." }
@{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress
`;

const snapWindowMacScript = `
ObjC.import('AppKit');

function run(argv) {
	const segment = Number(argv[0]);
	const fraction = Number(argv[1]);
  const systemEvents = Application('System Events');
  const application = systemEvents.applicationProcesses.whose({ frontmost: true })()[0];
  const window = application.windows[0];
  const [windowX, windowY] = window.position();
  const [windowWidth, windowHeight] = window.size();
	const originalBounds = { x: Number(windowX), y: Number(windowY), width: Number(windowWidth), height: Number(windowHeight) };

  const screens = [];
  const nsScreens = $.NSScreen.screens;
  for (let index = 0; index < nsScreens.count; index++) {
    const screen = nsScreens.objectAtIndex(index);
    const frame = screen.frame;
    const visibleFrame = screen.visibleFrame;
    screens.push({
      x: Number(frame.origin.x), y: Number(frame.origin.y), width: Number(frame.size.width), height: Number(frame.size.height),
      visibleX: Number(visibleFrame.origin.x), visibleY: Number(visibleFrame.origin.y), visibleWidth: Number(visibleFrame.size.width), visibleHeight: Number(visibleFrame.size.height)
    });
  }

  const virtualTop = Math.max(...screens.map((screen) => screen.y + screen.height));
  const centerX = windowX + windowWidth / 2;
  const centerY = virtualTop - (windowY + windowHeight / 2);
  const screen = screens.find((candidate) =>
    centerX >= candidate.x && centerX <= candidate.x + candidate.width &&
    centerY >= candidate.y && centerY <= candidate.y + candidate.height) || screens[0];
  const targetWidth = Math.floor(screen.visibleWidth / fraction);
  const targetX = segment === fraction - 1 ? screen.visibleX + screen.visibleWidth - targetWidth : screen.visibleX + targetWidth * segment;
  const targetY = virtualTop - screen.visibleY - screen.visibleHeight;
  window.position = [Math.round(targetX), Math.round(targetY)];
  window.size = [targetWidth, Math.round(screen.visibleHeight)];
	return JSON.stringify(originalBounds);
}
`;

const snapWindowWindowsScript = `
$segment = [int]$args[0]; $fraction = [int]$args[1]
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SnapWindowControl {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public int dwFlags; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO monitorInfo);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
}
'@
$window = [SnapWindowControl]::GetForegroundWindow()
if ($window -eq [IntPtr]::Zero) { throw "No focused window found." }
$rect = New-Object SnapWindowControl+RECT
[void][SnapWindowControl]::GetWindowRect($window, [ref]$rect)
$monitor = [SnapWindowControl]::MonitorFromWindow($window, 2); $info = New-Object SnapWindowControl+MONITORINFO; $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
if (-not [SnapWindowControl]::GetMonitorInfo($monitor, [ref]$info)) { throw "Unable to find the current monitor." }
$workArea = $info.rcWork; $width = [Math]::Floor(($workArea.Right - $workArea.Left) / $fraction); $height = $workArea.Bottom - $workArea.Top
$x = if ($segment -eq ($fraction - 1)) { $workArea.Right - $width } else { $workArea.Left + $width * $segment }
if (-not [SnapWindowControl]::MoveWindow($window, $x, $workArea.Top, $width, $height, $true)) { throw "Unable to snap focused window." }
@{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress
`;

const restoreWindowMacScript = `on run argv
	set windowX to (item 1 of argv) as integer
	set windowY to (item 2 of argv) as integer
	set windowWidth to (item 3 of argv) as integer
	set windowHeight to (item 4 of argv) as integer
	tell application "System Events"
		set frontApp to first application process whose frontmost is true
		tell window 1 of frontApp
			set position to {windowX, windowY}
			set size to {windowWidth, windowHeight}
		end tell
	end tell
end run`;

const restoreWindowWindowsScript = `
$x = [int]$args[0]; $y = [int]$args[1]; $width = [int]$args[2]; $height = [int]$args[3]
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RestoreWindowControl {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
}
'@
$window = [RestoreWindowControl]::GetForegroundWindow()
if ($window -eq [IntPtr]::Zero -or -not [RestoreWindowControl]::MoveWindow($window, $x, $y, $width, $height, $true)) { throw "Unable to restore focused window." }
`;
