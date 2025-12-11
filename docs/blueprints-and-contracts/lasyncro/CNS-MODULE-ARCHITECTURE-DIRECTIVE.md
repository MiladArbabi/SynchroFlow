# CNS MODULE ARCHITECTURE DIRECTIVE

## **SYSTEM PRINCIPLES**

**OBJECTIVE:** Establish a consistent blueprinting framework for all CNS modules before implementation lock.

**PRECONDITION:** Module design occurs in two-phase sequence:

1. **Blueprint Phase** - Answer 7 core questions
2. **Implementation Phase** - Execute against locked blueprint

**RULE:** No module progresses to implementation until blueprint is complete and validated.

---

## **BLUEPRINT TEMPLATE (7-CORE QUESTIONS)**

For any CNS module `M`, define:

### **1. JOB-TO-BE-DONE**
```
Define: "What fundamental business job does M perform for the merchant?"
Format: Single action-oriented sentence
Pattern: "Make [business outcome] [descriptor]"
Example: "Make profitability obvious per order"
```

### **2. FREE-TIER AHA MOMENT**
```
Define: "What single interaction creates immediate perceived value?"
Constraints: Must be achievable within 60 seconds of module entry
Requirement: Must trigger "This is useful" cognitive response
```

### **3. PHASE PROGRESSION**
```
Define feature allocation across maturity phases:
- Phase 1 (FT0-FT1): Survival essentials
- Phase 2 (Growth Intelligence): Leverage multipliers  
- Phase 3 (Architect Automation): Systemic optimization
Rule: No Phase 2 features in Phase 1 implementation
```

### **4. ANALYTICS PRIMITIVES**
```
Define atomic data entities module owns and computes:
- Format: List of primitive identifiers
- Rule: Each primitive must have single module ownership
- Requirement: Include computational logic specification
```

### **5. WIDGET HIERARCHY**
```
Define UI surfaces across merchant modes:
- Survival Mode: Immediate problem resolution
- Growth Mode: Leverage optimization  
- Architect Mode: Systemic redesign
Constraint: Widgets must map directly to primitives from Q4
```

### **6. CLEAR PATH ACTIONS**
```
Define merchant-actionable pathways:
- Survival Actions: Immediate fix operations
- Growth Actions: Strategic optimization operations  
- Architect Actions: System redesign operations
Requirement: Each action must have defined trigger condition
```

### **7. CLOSED LOOP MECHANISM**
```
Define learning system:
- Input: Merchant interaction patterns
- Processing: Behavior analysis logic
- Output: Module self-optimization adjustments
Constraint: Must operate without manual configuration
```

---

## **VALIDATION SEQUENCE**

```
SEQUENCE module_blueprint_validation:
  FOR each module M in CNS_MODULES:
    IF blueprint_complete(M, 7_questions) = FALSE:
      BLOCK implementation_phase(M)
      GENERATE blueprint_deficit_report(M)
    ELSE:
      VALIDATE cross_module_dependency(M)
      VALIDATE primitive_ownership_conflicts(M)
      GENERATE implementation_spec(M)
      UNLOCK implementation_phase(M)
  END FOR
END SEQUENCE
```

---

## **DEPENDENCY RULES**

1. **Primitive Ownership:** Each analytics primitive has exactly one owning module
2. **Widget Allocation:** Widgets exist in exactly one merchant mode context
3. **Action Hierarchy:** Survival actions must precede growth actions in implementation
4. **Phase Gating:** No feature may skip its allocated phase
5. **Learning Integration:** All modules must implement closed-loop feedback

---

## **OUTPUT ARTIFACTS**

Upon blueprint completion for module `M`, generate:

1. `M_blueprint.json` - Structured answers to 7 questions
2. `M_primitives.spec` - Analytics primitive specifications
3. `M_widgets.layout` - Widget hierarchy and placement
4. `M_actions.workflow` - Clear path action sequences
5. `M_learning.model` - Closed-loop adaptation logic

---

## **COMPLIANCE CHECK**

Before module implementation approval, verify:

- [ ] All 7 questions answered with concrete specifications
- [ ] No analytics primitive ownership conflicts with existing modules
- [ ] Free-tier aha moment achievable within 60-second interaction
- [ ] Phase allocation follows progressive enhancement principle
- [ ] Closed-loop mechanism defined with measurable adaptation criteria

---

## **DIRECTIVE SUMMARY**

This framework ensures:

1. **Consistency** - All modules follow identical design methodology
2. **Completeness** - No implementation begins with undefined aspects
3. **Cohesion** - Module interdependencies are explicitly mapped
4. **Evolution** - Closed-loop systems enable autonomous improvement
5. **Clarity** - Every module has defined north star and progression path

**Execute this directive before any further module specification.**