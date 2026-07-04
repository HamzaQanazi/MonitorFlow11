// Service Catalogue (Section 4, User app) — GET /services, tap → Create
// Request for that service.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../models/request.dart';
import '../theme.dart';
import '../widgets/states.dart';
import 'create_request_screen.dart';

class CatalogueScreen extends StatefulWidget {
  const CatalogueScreen({super.key});

  @override
  State<CatalogueScreen> createState() => _CatalogueScreenState();
}

class _CatalogueScreenState extends State<CatalogueScreen> {
  late Future<List<ServiceType>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<ServiceType>> _load() async {
    final api = context.read<AuthState>().api;
    final json = await api.get('/services');
    return (json['services'] as List<dynamic>)
        .map((s) => ServiceType.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choose a service')),
      body: FutureBuilder<List<ServiceType>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const LoadingState();
          }
          if (snap.hasError) {
            return ErrorState(
              message: snap.error is NetworkException
                  ? 'Could not reach the server — check your connection.'
                  : 'Could not load services.',
              onRetry: () => setState(() => _future = _load()),
            );
          }
          final services = snap.data!;
          if (services.isEmpty) {
            return const EmptyState(
              icon: Icons.category_outlined,
              title: 'No services available',
              subtitle: 'Check back later.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: services.length,
            separatorBuilder: (_, _) => const SizedBox(height: 12),
            itemBuilder: (context, i) {
              final s = services[i];
              return Material(
                color: MfColors.bg,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: const BorderSide(color: MfColors.border),
                ),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => CreateRequestScreen(service: s),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(s.name,
                                  style: const TextStyle(
                                      fontSize: 16, fontWeight: FontWeight.w600)),
                              const SizedBox(height: 4),
                              Text(s.departmentName,
                                  style: const TextStyle(color: MfColors.muted, fontSize: 13)),
                            ],
                          ),
                        ),
                        const Icon(Icons.chevron_right, color: MfColors.borderStrong),
                      ],
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
