// Full-screen map pin picker (v5 amendment). Pushed by the host screen's
// LocationPicker callback; pops with {lat, lng} on confirm, null on back.
// Kept out of the renderer so widget tests never touch flutter_map.
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../i18n.dart';
import '../theme.dart';

const _nablus = LatLng(32.22, 35.26);

class LocationPickerScreen extends StatefulWidget {
  /// Existing {lat, lng} value when changing a set location.
  final Map<String, dynamic>? initial;

  const LocationPickerScreen({super.key, this.initial});

  @override
  State<LocationPickerScreen> createState() => _LocationPickerScreenState();
}

class _LocationPickerScreenState extends State<LocationPickerScreen> {
  final _mapController = MapController();
  LatLng? _picked;
  bool _locating = false;

  @override
  void initState() {
    super.initState();
    final i = widget.initial;
    if (i != null) {
      _picked = LatLng((i['lat'] as num).toDouble(), (i['lng'] as num).toDouble());
    } else {
      // No prior pin → auto-detect the device's current location once and drop
      // the pin there (the user can still tap to adjust). One-shot only, never
      // a continuous stream — MonitorFlow measures outcomes, not whereabouts.
      WidgetsBinding.instance.addPostFrameCallback((_) => _detectLocation());
    }
  }

  Future<void> _detectLocation() async {
    setState(() => _locating = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return; // fall back to manual tap; the map stays on the default center
      }
      final pos = await Geolocator.getCurrentPosition();
      if (!mounted) return;
      final here = LatLng(pos.latitude, pos.longitude);
      setState(() => _picked = here);
      _mapController.move(here, 16);
    } catch (_) {
      // Any failure (timeout, platform error) → silent fall back to tapping.
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(
        title: Text(i18n.tr('lp_title')),
        actions: [
          IconButton(
            key: const ValueKey('location-picker-confirm'),
            icon: const Icon(Icons.check),
            tooltip: i18n.tr('lp_use'),
            onPressed: _picked == null
                ? null
                : () => Navigator.pop(context, <String, dynamic>{
                      'lat': _picked!.latitude,
                      'lng': _picked!.longitude,
                    }),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              children: [
                FlutterMap(
              mapController: _mapController,
              options: MapOptions(
                initialCenter: _picked ?? _nablus,
                initialZoom: _picked != null ? 16 : 12,
                onTap: (_, latLng) => setState(() => _picked = latLng),
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'dev.monitorflow.monitorflow_mobile',
                ),
                if (_picked != null)
                  MarkerLayer(
                    markers: [
                      Marker(
                        point: _picked!,
                        width: 40,
                        height: 40,
                        alignment: Alignment.topCenter,
                        child: const Icon(Icons.place,
                            size: 40, color: MfColors.amber600),
                      ),
                    ],
                  ),
              ],
            ),
                PositionedDirectional(
                  bottom: 16,
                  end: 16,
                  child: FloatingActionButton.small(
                    heroTag: 'locate-me',
                    tooltip: i18n.tr('lp_my_location'),
                    onPressed: _locating ? null : _detectLocation,
                    child: _locating
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2.5),
                          )
                        : const Icon(Icons.my_location),
                  ),
                ),
              ],
            ),
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            color: MfColors.surface,
            child: Text(
              _locating
                  ? i18n.tr('lp_locating')
                  : _picked == null
                      ? i18n.tr('lp_tap')
                      : '${_picked!.latitude.toStringAsFixed(5)}, '
                          '${_picked!.longitude.toStringAsFixed(5)}',
              textAlign: TextAlign.center,
              style: const TextStyle(color: MfColors.muted, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}
