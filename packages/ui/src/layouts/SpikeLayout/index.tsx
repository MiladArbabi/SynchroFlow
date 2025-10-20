// packages/ui/src/layouts/SpikeLayout/index.tsx
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
// 1. IMPORT CHANGE: We are now using the base GridLayout instead of Responsive
import RGL, { WidthProvider } from "react-grid-layout";
import MDBox from "../../components/MDBox";

// We now use the WidthProvider directly on our base RGL component
const GridLayout = WidthProvider(RGL);

const panelStyle = (color: string) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: `1px solid ${color}`,
  overflow: "auto",
  height: "100%",
  boxSizing: "border-box",
});
const handleStyle = {
  width: "4px",
  background: "#333",
  cursor: "col-resize",
};
const verticalHandleStyle = {
  height: "4px",
  background: "#333",
  cursor: "row-resize",
};

function SpikeResizableLayout() {
  const layout = [
    { i: "a", x: 0, y: 0, w: 4, h: 2 },
    { i: "b", x: 4, y: 0, w: 4, h: 2 },
    { i: "c", x: 0, y: 2, w: 8, h: 2 },
  ];

  return (
    <MDBox
      sx={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <MDBox
        sx={{
          ...panelStyle("#999"),
          height: "60px",
          flexShrink: 0,
          width: "100%",
        }}
      >
        Topnavbar (Fixed 60px)
      </MDBox>

      <MDBox sx={{ flexGrow: 1, height: "calc(100vh - 60px)" }}>
        <PanelGroup direction="horizontal">
          <Panel defaultSize={20} minSize={15} maxSize={30}>
            <MDBox sx={panelStyle("#f00")}>Sidenav</MDBox>
          </Panel>
          <PanelResizeHandle style={handleStyle} />

          <Panel>
            <PanelGroup direction="vertical">
              <Panel defaultSize={75} minSize={50}>
                <MDBox sx={{ ...panelStyle("#0f0"), padding: "10px" }}>

                  {/* 2. COMPONENT CHANGE: Switched to the non-responsive GridLayout */}
                  <GridLayout
                    className="layout"
                    // The `layout` prop now takes a direct array, not an object
                    layout={layout}
                    // We define a fixed number of columns. This is key.
                    cols={12}
                    rowHeight={100}
                    style={{
                      width: "100%",
                      height: "100%",
                      background: "#fff",
                    }}
                    // 3. CONFIGURATION CHANGES: These are critical for the "stay put" behavior
                    compactType={null}      // Disables auto-compaction
                    preventCollision={true} // Prevents widgets from overlapping when dragging
                  >
                    <MDBox
                      key="a"
                      sx={{ ...panelStyle("#777"), background: "#eee" }}
                    >
                      Widget A
                    </MDBox>
                    <MDBox
                      key="b"
                      sx={{ ...panelStyle("#777"), background: "#eee" }}
                    >
                      Widget B
                    </MDBox>
                    <MDBox
                      key="c"
                      sx={{ ...panelStyle("#777"), background: "#eee" }}
                    >
                      Widget C
                    </MDBox>
                  </GridLayout>
                </MDBox>
              </Panel>
              <PanelResizeHandle style={verticalHandleStyle} />
              <Panel defaultSize={25} minSize={10}>
                <MDBox sx={panelStyle("#00f")}>Ops Console</MDBox>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </MDBox>
    </MDBox>
  );
}

export default SpikeResizableLayout;