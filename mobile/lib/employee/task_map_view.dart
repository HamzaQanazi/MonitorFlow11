// Map mode for Employee Home + My Tasks (v5 amendment) — active tasks as
// category-colored pins over OSM tiles. Employees appear only via their
// tasks' locations; there is no GPS anywhere (Section 12 stays cut).
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../i18n.dart';
import '../models/task.dart';
import '../theme.dart';
import '../widgets/states.dart';

class TaskMapView extends StatelessWidget {
  /// Already filtered by the host (active only + the chip filter).
  final List<TaskSummary> tasks;
  final Future<void> Function(TaskSummary) onOpen;

  const TaskMapView({super.key, required this.tasks, required this.onOpen});

  void _sheet(BuildContext context, TaskSummary t) {
    final i18n = context.read<I18n>();
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
                      i18n.l(t.serviceTypeName),
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                    ),
                  ),
                  StatusPill(status: t.status),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '${i18n.tr('eh_task')} #${t.id} · ${i18n.tr('eh_request')} #${t.requestId} · '
                '${i18n.priorityPhrase(t.priority)}',
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
                  child: Text(i18n.tr('tm_open')),
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
    final i18n = context.watch<I18n>();
    final located = tasks.where((t) => t.location != null).toList();
    final missing = tasks.length - located.length;

    if (located.isEmpty) {
      return EmptyState(
        icon: Icons.map_outlined,
        title: i18n.tr('tm_nothing_title'),
        subtitle: i18n.tr('tm_nothing_sub'),
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
                          color: stateColors(t.status.isTerminal).accent,
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
                  ? i18n.tr('tm_missing_one')
                  : '$missing ${i18n.tr('tm_missing_pre')}',
              textAlign: TextAlign.center,
              style: const TextStyle(color: MfColors.muted, fontSize: 12),
            ),
          ),
      ],
    );
  }
}
