import { notFound } from "next/navigation";
import ProjectDetails from "../../../components/projects/ProjectDetails";

export default async function Page({ params }) {
    const { projectId } = await params;

    if (
        typeof projectId !== "string" ||
        !projectId.trim() ||
        projectId === "undefined" ||
        projectId === "null"
    ) {
        notFound();
    }

    return (
        <ProjectDetails
            key={projectId}
            projectId={projectId}
        />
    );
}
