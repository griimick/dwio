/**
 * A short style guide for agents that draw with the MCP tools. It is returned by the get_style_guide tool, so it
 * costs tokens only when an agent asks for it. Written for editing files: the agent can render and look at the result.
 * Every style in it is drawn in test/style-guide.test.ts, so a wrong style cannot stay in this text.
 */

/** Shape styles shown in the guide, as [name, style, width, height]. The test draws each one. */
export const SHAPE_STYLES: [string, string, number, number][] = [
  ["box", "whiteSpace=wrap;html=1;", 120, 60],
  ["rounded box", "rounded=1;whiteSpace=wrap;html=1;", 120, 60],
  ["decision", "rhombus;whiteSpace=wrap;html=1;", 120, 80],
  ["start or end", "ellipse;whiteSpace=wrap;html=1;", 120, 60],
  ["database", "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;", 80, 90],
  ["document", "shape=document;whiteSpace=wrap;html=1;boundedLbl=1;", 120, 80],
  ["hexagon", "shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;", 120, 80],
  ["cloud", "ellipse;shape=cloud;whiteSpace=wrap;html=1;", 120, 80],
  ["person", "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;", 30, 60],
  ["note text", "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;", 160, 30],
];

/** Colors, as [name, fillColor, strokeColor]. */
export const COLORS: [string, string, string][] = [
  ["blue", "#dae8fc", "#6c8ebf"],
  ["green", "#d5e8d4", "#82b366"],
  ["yellow", "#fff2cc", "#d6b656"],
  ["orange", "#ffe6cc", "#d79b00"],
  ["red", "#f8cecc", "#b85450"],
  ["purple", "#e1d5e7", "#9673a6"],
  ["gray", "#f5f5f5", "#666666"],
];

export const EDGE_STYLES: [string, string][] = [
  ["right-angle arrow (default choice)", "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;"],
  ["straight arrow", "endArrow=classic;html=1;"],
  ["dashed arrow (async, optional)", "endArrow=classic;html=1;dashed=1;"],
  ["line without arrowheads", "endArrow=none;html=1;"],
  ["arrow at both ends", "startArrow=classic;endArrow=classic;html=1;"],
];

export const CONTAINER_STYLE = "swimlane;startSize=30;html=1;fillColor=#f5f5f5;strokeColor=#666666;";

export const STYLE_GUIDE = `Style guide for apply_changes

Sizes and layout
- Coordinates are pixels, and y grows downward. A shape is 120 x 60 by default. Use a grid of 180 px between columns and 120 px between rows, and keep connected shapes in neighbouring cells so the arrows stay short.
- Leave room for labels. Do not put two shapes on the same spot. If you add a shape without x and y, it goes to the right of the existing shapes.
- After you change a diagram, call render and look at it. Fix overlaps and crossing arrows with update (x, y, width, height).

Shapes (the "style" of add_vertex). Always keep html=1.
${SHAPE_STYLES.map(([n, s, w, h]) => `- ${n}: ${s}  (${w} x ${h})`).join("\n")}

Colors. Add fillColor and strokeColor to a style. Use one color for one kind of thing (for example blue for services, green for data, red for errors).
${COLORS.map(([n, f, s]) => `- ${n}: fillColor=${f};strokeColor=${s};`).join("\n")}
Text: fontSize=14; fontStyle=1 is bold. To change only the color of a shape, use update with style_set, for example {"fillColor": "#d5e8d4"}.

Arrows (the "style" of add_edge). Give source and target ids. Do not add waypoints unless an arrow crosses a shape.
${EDGE_STYLES.map(([n, s]) => `- ${n}: ${s}`).join("\n")}
Short labels (1 to 3 words) go in "label".

Containers. A container is a normal shape with a container style, for example ${CONTAINER_STYLE}
Make the children with add_vertex and "parent" set to the container's id. A child's x and y are relative to the container (the title bar is 30 px high). Make the container big enough for its children. Connect shapes with arrows at the top level (leave "parent" out) unless both ends are in the same container.

Labels are plain text. Use \\n for a line break. Do not write HTML.

Icons and logos. For cloud, network, Kubernetes or brand icons, do not guess the shape name. If you have a shape search tool (for example the draw.io MCP "search_shapes"), search for the icon and pass the style string from the result as "style". Its size is in the result too.

Not possible with these tools yet: layers, tags and metadata, new pages, and automatic layout. Place shapes by hand and check with render.`;
