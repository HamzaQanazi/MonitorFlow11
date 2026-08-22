import type { Loc } from '../i18n'

// A service's (or checklist's) owner_id is Gate 2's visibility anchor — which
// team the person sits in is the whole point of the choice, so a picker that
// shows a bare name hides the one thing you need. Shared by the Add Service
// wizard and the new-checklist dialog so both read the same way.

export interface EmployeeOption {
  id: number
  name: string
  departmentId: number | null
  departmentName: Loc | null
  branchName: Loc | null
}

// "Maya Chen — Operations · Main branch"
export function ownerLabel(emp: EmployeeOption, L: (v: Loc) => string): string {
  const where = [emp.departmentName, emp.branchName].filter(Boolean).map((v) => L(v as Loc))
  return where.length ? `${emp.name} — ${where.join(' · ')}` : emp.name
}
