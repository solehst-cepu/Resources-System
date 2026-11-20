import {
  CheckCircle2,
  Clock,
  PackageCheck,
  RefreshCw,
  Truck,
  XCircle,
} from 'lucide-react';
import type { OrderStatus } from '../types/lrms.ts';

export function OrderStatusText({ status }: { status: OrderStatus }) {
  switch (status) {
    case 'Menunggu Diproses':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span>Menunggu Diproses</span>
        </span>
      );
    case 'Diproses':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <RefreshCw className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>Diproses</span>
        </span>
      );
    case 'Dalam Pengiriman':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1755CE] whitespace-nowrap">
          <Truck className="w-3.5 h-3.5 text-[#1755CE] shrink-0" />
          <span>Dalam Pengiriman</span>
        </span>
      );
    case 'Siap Diambil':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <PackageCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>Siap Diambil</span>
        </span>
      );
    case 'Selesai':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>Selesai</span>
        </span>
      );
    case 'Dibatalkan':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
          <span>Dibatalkan</span>
        </span>
      );
  }
}

export function ActiveStatusText({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
      <span>Aktif</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
      <XCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span>Nonaktif</span>
    </span>
  );
}
