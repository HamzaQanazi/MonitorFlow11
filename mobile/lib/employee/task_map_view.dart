// Map mode for Employee Home + My Tasks (v5 amendment) — active tasks as
// category-colored pins over OSM tiles. Employees appear only via their
// tasks' locations; there is no GPS anywhere (Section 12 stays cut).
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../models/task.dart';
import '../theme.dart';
import '../widgets/states.dart';

class TaskMapView extends StatelessWidget {
  /// Already filtered by the host (active only + the chip filter).
  final List<TaskSummary> tasks;
  final Future<void> Function(TaskSummary) onOpen;

  const TaskMapView({super.key, required this.tasks, required this.onOpen});

  void _sheet(BuildContext context, TaskSummary t) {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetCtx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      t.serviceTypeName,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                    ),
                  ),
                  StatusPill(status: t.status),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'Task #${t.id} · Request #${t.requestId} · ${t.priority} priority',
                style: const TextStyle(color: MfColors.muted, fontSize: 13),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.pop(sheetCtx);
                    onOpen(t);
                  },
                  child: const Text('Open task'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final located = tasks.where((t) => t.location != null).toList();
    final missing = tasks.length - located.length;

    if (located.isEmpty) {
      return const EmptyState(
        icon: Icons.map_outlined,
        title: 'Nothing to map',
        subtitle: 'Active tasks with a location will appear here.',
      );
    }

    return Column(
      children: [
        Expanded(
          child: FlutterMap(
            options: MapOptions(
              initialCameraFit: CameraFit.coordinates(
                coordinates: [
                  for (final t in located) LatLng(t.location!.lat, t.location!.lng),
                ],
                padding: const EdgeInsets.all(48),
                maxZoom: 16,
              ),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'dev.monitorflow.monitorflow_mobile',
              ),
              MarkerLayer(
                markers: [
                  for (final t in located)
                    Marker(
                      point: LatLng(t.location!.lat, t.location!.lng),
                      width: 44,
                      height: 44,
                      alignment: Alignment.topCenter,
                      child: GestureDetector(
                        onTap: () => _sheet(context, t),
                        child: Icon(
                          Icons.place,
                          size: 40,
                          color: categoryColors(t.status.category).accent,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
        if (missing > 0)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            color: MfColors.surface,
            child: Text(
              missing == 1
                  ? '1 task has no location'
                  : '$missing tasks have no location',
              textAlign: TextAlign.center,
              style: const TextStyle(color: MfColors.muted, fontSize: 12),
            ),
          ),
      ],
    );
  }
}
