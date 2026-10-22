import { notFound } from "next/navigation";
import ProjectDetails from "../../../../components/projects/ProjectDetails";

export default async function Page({ params }) {
    const { projectId } = await params;

    if (!projectId || projectId === "undefined") {
        notFound();
    }

    return (
        <ProjectDetails
            key={projectId}
            projectId={projectId}
            settings
        />
    );
}