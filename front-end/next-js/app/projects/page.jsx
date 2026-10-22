import { Suspense } from 'react';
import ProjectsPage from '../../components/projects/ProjectsPage';
export default function Page() { return <Suspense fallback={<p role="status">Loading projects...</p>}><ProjectsPage /></Suspense>; }
