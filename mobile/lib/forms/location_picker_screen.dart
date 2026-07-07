// Full-screen map pin picker (v5 amendment). Pushed by the host screen's
// LocationPicker callback; pops with {lat, lng} on confirm, null on back.
// Kept out of the renderer so widget tests never touch flutter_map.
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../theme.dart';

const _amman = LatLng(31.95, 35.91);

class LocationPickerScreen extends StatefulWidget {
  /// Existing {lat, lng} value when changing a set location.
  final Map<String, dynamic>? initial;

  const LocationPickerScreen({super.key, this.initial});

  @override
  State<LocationPickerScreen> createState() => _LocationPickerScreenState();
}

class _LocationPickerScreenState extends State<LocationPickerScreen> {
  LatLng? _picked;

  @override
  void initState() {
    super.initState();
    final i = widget.initial;
    if (i != null) {
      _picked = LatLng((i['lat'] as num).toDouble(), (i['lng'] as num).toDouble());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pick a location'),
        actions: [
          IconButton(
            key: const ValueKey('location-picker-confirm'),
            icon: const Icon(Icons.check),
            tooltip: 'Use this location',
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
            child: FlutterMap(
              options: MapOptions(
                initialCenter: _picked ?? _amman,
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
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            color: MfColors.surface,
            child: Text(
              _picked == null
                  ? 'Tap the map to drop a pin'
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
