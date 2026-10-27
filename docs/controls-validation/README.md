# Touch pan controls

Removed device orientation input, its auto-enable/permission request, and tilt button.
Touch-drag yaw/pitch and the independent movement stick remain active, alongside
mouse and gamepad input. Browser input smoke checks exercised actual Player and
Joystick modules with CDP touch events: horizontal/vertical drag, simultaneous
movement plus look, cancel and a fresh drag, and ignored device-orientation events.
No sensor listeners or browser exceptions were observed.

The matched 390×844 before/after images isolate the HTML controls with the entry
overlay hidden and no game renderer; they document removal of the tilt button,
not a world rendering or phone performance test.
