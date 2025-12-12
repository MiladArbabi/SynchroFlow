/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { useParams } from "react-router-dom";
import { loadModule } from "./moduleLoader";
import moduleEntries from "virtual:lasyncro-modules";

interface ModuleHostProps {
  moduleId?: string;
  route?: string;
}

export default function ModuleHost(props: ModuleHostProps) {
  const params = useParams();
  const resolvedModuleId = props.moduleId || (params.moduleId as string);

  const [Component, setComponent] = React.useState<React.ReactNode>(null);

  React.useEffect(() => {
    let isMounted = true;

    async function run() {
      try {
        // ✔ Lookup entry object first
        const entry = moduleEntries.find((m) => m.id === resolvedModuleId);

        if (!entry) {
          console.error("[ModuleHost] No module entry found for:", resolvedModuleId);
          return;
        }

        // ✔ Load via moduleLoader
        const desc = await loadModule(entry);

        if (!desc) {
          console.error("[ModuleHost] loadModule returned null for:", resolvedModuleId);
          return;
        }

        const descriptor = desc;

        if (!descriptor.routes) {
          console.error("[ModuleHost] descriptor.routes missing for:", resolvedModuleId);
          return;
        }

        const selected =
          (props.route &&
            descriptor.routes.find((r: any) => r.path === props.route)) ||
          descriptor.routes[0];

        if (!selected) {
          console.error("[ModuleHost] No matching route found inside:", resolvedModuleId);
          return;
        }

        if (isMounted) {
          setComponent(React.createElement(selected.component));
        }
      } catch (err) {
        console.error("[ModuleHost] Fatal load error:", err);
      }
    }

    run();
    return () => {
      isMounted = false;
    };
  }, [resolvedModuleId, props.route]);

  return <>{Component}</>;
}
