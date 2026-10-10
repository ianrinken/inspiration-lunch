/* Spanish for handbooks.js: bell schedules, lunch, attendance, contacts and
 * rules, keyed by the English text (the same way as i18n.js). Names of
 * people stay as written. When a handbook is re-extracted, the unit test
 * "every handbook string has Spanish" lists anything new to translate here.
 */
(() => {
  const es = {
    // Bell schedules
    "Regular day": "Día regular",
    "WIN Mon-Thu, Ad-Room Fri. 4th and 5th periods split into A/B halves.": "WIN de lunes a jueves, Ad-Room los viernes. Los periodos 4 y 5 se dividen en mitades A y B.",
    "1st Period": "1.er periodo",
    "2nd Period": "2.º periodo",
    "WIN / Ad-Room": "WIN / Ad-Room",
    "3rd Period": "3.er periodo",
    "4th Period": "4.º periodo",
    "5th Period": "5.º periodo",
    "6th Period": "6.º periodo",
    "7th Period": "7.º periodo",
    "1 hour late start": "Entrada 1 hora tarde",
    "From 4th period (11:43) on, the regular day's times apply.": "Desde el 4.º periodo (11:43) se sigue el horario del día regular.",
    "2 hour late start": "Entrada 2 horas tarde",
    "Periods run out of order: 3rd period moves to the end of the day.": "Los periodos cambian de orden: el 3.er periodo pasa al final del día.",
    "Early release": "Salida temprana",
    "Periods run out of order: 6th and 7th come before 4th and 5th.": "Los periodos cambian de orden: el 6.º y el 7.º van antes del 4.º y el 5.º.",
    "7th Period / Announcements": "7.º periodo / Anuncios",
    "1st semester tests - Day 1": "Exámenes del 1.er semestre: día 1",
    "Period 1 test": "Examen del periodo 1",
    "Period 4 or 5 test": "Examen del periodo 4 o 5",
    "Lunch": "Almuerzo",
    "Period 6 test": "Examen del periodo 6",
    "Make-up tests": "Exámenes de reposición",
    "1st semester tests - Day 2": "Exámenes del 1.er semestre: día 2",
    "Period 2 test": "Examen del periodo 2",
    "Period 3 test": "Examen del periodo 3",
    "Period 7 test": "Examen del periodo 7",
    "2nd semester tests - Day 1": "Exámenes del 2.º semestre: día 1",
    "Lunch: 9th lunch/10th Ad-Room 11:30-11:56, 10th lunch/9th Ad-Room 12:00-12:26; 11th & 12th graders have open lunch 11:30-12:26.": "Almuerzo: grado 9 almuerza y grado 10 en Ad-Room de 11:30 a 11:56; grado 10 almuerza y grado 9 en Ad-Room de 12:00 a 12:26; los grados 11 y 12 tienen almuerzo libre de 11:30 a 12:26.",
    "9th Lunch / 10th Ad-Room": "Almuerzo grado 9 / Ad-Room grado 10",
    "10th Lunch / 9th Ad-Room": "Almuerzo grado 10 / Ad-Room grado 9",
    "Ad-Room": "Ad-Room",
    "2nd semester tests - Day 2": "Exámenes del 2.º semestre: día 2",
    "Same lunch split as Day 1; 11th & 12th graders have open lunch 11:30-12:26.": "Mismos turnos de almuerzo que el día 1; los grados 11 y 12 tienen almuerzo libre de 11:30 a 12:26.",
    "Arrival 7:50. Reading period daily before 3rd period. Period 4 is the 65-minute lunch block.": "Llegada a las 7:50. Periodo de lectura todos los días antes del 3.er periodo. El periodo 4 es el bloque de almuerzo de 65 minutos.",
    "Period 1": "Periodo 1",
    "Period 2": "Periodo 2",
    "Reading": "Lectura",
    "Period 3": "Periodo 3",
    "Period 4 (lunch)": "Periodo 4 (almuerzo)",
    "Sophomore Lunch": "Almuerzo de grado 10",
    "Sophomore Study Hall": "Sala de estudio de grado 10",
    "Freshmen Lunch": "Almuerzo de grado 9",
    "Freshmen Study Hall": "Sala de estudio de grado 9",
    "Period 5": "Periodo 5",
    "Period 6": "Periodo 6",
    "Period 7": "Periodo 7",
    "School 8:15-3:10. Ad Room daily. 4th and 5th periods split into A/B halves (lunch on one, SRP on the other).": "Clases de 8:15 a 3:10. Ad Room todos los días. Los periodos 4 y 5 se dividen en mitades A y B (almuerzo en una y SRP en la otra).",
    "Ad Room": "Ad Room",
    "Period 4A": "Periodo 4A",
    "Period 4B": "Periodo 4B",
    "Period 5A": "Periodo 5A",
    "Period 5B": "Periodo 5B",
    "Warrior Halftime (65 min) replaces a lunch period: 9th/10th get a study hall and a lunch half; 11th/12th get lunch/intervention for the whole block.": "Warrior Halftime (65 min) reemplaza el periodo de almuerzo: los grados 9 y 10 tienen una mitad de estudio y otra de almuerzo; los grados 11 y 12 tienen almuerzo o apoyo académico todo el bloque.",
    "Reading Period": "Periodo de lectura",
    "Warrior Halftime": "Warrior Halftime",
    "Freshman Study": "Estudio de grado 9",
    "Freshman Lunch": "Almuerzo de grado 9",
    "Sophomore Study": "Estudio de grado 10",
    "Juniors & Seniors Lunch/Intervention": "Almuerzo o apoyo académico de grados 11 y 12",
    "3rd period moves to after Warrior Halftime; no reading period.": "El 3.er periodo pasa a después de Warrior Halftime; no hay periodo de lectura.",
    "In-service / tournament (early release)": "Capacitación / torneo (salida temprana)",
    "Washington calls this the In-Service and Tournament schedule. The day starts at 7:30 and ends at 12:30.": "Washington lo llama el horario de capacitación y torneo. El día empieza a las 7:30 y termina a las 12:30.",
    "Semester tests - Day 1": "Exámenes semestrales: día 1",
    "Buses run at 2:05; specialized transportation at 1:45; make-up/recovery 1:40-3:10.": "Los autobuses salen a las 2:05; el transporte especializado a la 1:45; reposición y recuperación de 1:40 a 3:10.",
    "Lunch (in 6th)": "Almuerzo (en el 6.º)",
    "Make-up / Recovery": "Reposición / Recuperación",
    "Semester tests - Day 2": "Exámenes semestrales: día 2",
    "Lunch (in 7th)": "Almuerzo (en el 7.º)",

    // Lunch
    "Lunch falls in the A or B half of 4th or 5th period. Ask the school which half your student has. Juniors and seniors have open lunch if a parent completes the open lunch permission form (https://forms.gle/4jydgyJenVTaRisBA); they keep it by avoiding unexcused absences, suspensions, and coming back late. Phones may be used in the lunchroom during a student's lunch.":
      "El almuerzo cae en la mitad A o B del 4.º o 5.º periodo. Pregunte a la escuela qué mitad tiene su estudiante. Los estudiantes de grados 11 y 12 tienen almuerzo libre si un padre o madre llena el formulario de permiso de almuerzo libre (https://forms.gle/4jydgyJenVTaRisBA); lo conservan si evitan faltas injustificadas, suspensiones y regresar tarde. Se puede usar el teléfono en el comedor durante el almuerzo del estudiante.",
    "Period 4 (11:05-12:10) is a 65-minute lunch block: sophomores eat 11:05-11:30 then study hall 11:35-12:10; freshmen also have a lunch and study hall split. Juniors and seniors who are on track by credits and in good standing get open lunch for the whole 65 minutes once a parent completes the Annual Student Information Update; they must re-enter through Door A with their student ID and cannot bring outside food back in. Everyone else eats in the building and may leave only if a parent signs them out in Student Services. Phones are allowed only during lunch.":
      "El periodo 4 (11:05 a 12:10) es un bloque de almuerzo de 65 minutos: los de grado 10 comen de 11:05 a 11:30 y luego van a la sala de estudio de 11:35 a 12:10; los de grado 9 también dividen el bloque entre almuerzo y sala de estudio. Los de grados 11 y 12 que van al día con sus créditos y tienen buena conducta tienen almuerzo libre los 65 minutos cuando un padre o madre completa la Actualización Anual de Información del Estudiante; deben volver a entrar por la puerta A con su identificación y no pueden traer comida de fuera. Todos los demás comen en el edificio y solo pueden salir si un padre o madre los firma en Student Services. El teléfono solo se permite durante el almuerzo.",
    "Lunch is in one of the 4A/4B/5A/5B half-periods; the other half is the 25-minute Student Responsibility Period (SRP) for help from teachers. Some students have open lunch; ask Student Services who qualifies. Outside restaurant or fast-food meals are not allowed in the commons during lunch, and food deliveries to students are not permitted.":
      "El almuerzo es en uno de los medios periodos 4A, 4B, 5A o 5B; la otra mitad es el Periodo de Responsabilidad Estudiantil (SRP), de 25 minutos, para recibir ayuda de los maestros. Algunos estudiantes tienen almuerzo libre; pregunte en Student Services quién califica. No se permite comida de restaurantes ni comida rápida de fuera en el área común durante el almuerzo, ni entregas de comida a estudiantes.",
    "Lunch is part of Warrior Halftime, 65 minutes mid-day. Freshmen have study first and then lunch; sophomores have lunch first and then study. Juniors and seniors on track by credits and cohort, in good standing, whose parents completed the Annual Student Information Update before Warrior Day, get open lunch and sign a contract (a D or F can mean an assigned study hall instead). Students who stay may eat in the commons, then go to the gym or library (ID scan). No outside fast food or DoorDash, and students without open lunch may leave only if a parent signs them out in Student Services. Phones are allowed at lunch.":
      "El almuerzo es parte de Warrior Halftime, 65 minutos a mediodía. Los de grado 9 estudian primero y luego almuerzan; los de grado 10 almuerzan primero y luego estudian. Los de grados 11 y 12 que van al día con sus créditos y su generación, tienen buena conducta y cuyos padres completaron la Actualización Anual de Información del Estudiante antes del Warrior Day tienen almuerzo libre y firman un contrato (una D o F puede significar una sala de estudio asignada). Quienes se quedan pueden comer en el área común y luego ir al gimnasio o a la biblioteca (con su identificación). No se permite comida rápida de fuera ni DoorDash, y los estudiantes sin almuerzo libre solo pueden salir si un padre o madre los firma en Student Services. El teléfono se permite en el almuerzo.",

    // Attendance
    "A parent/guardian should report the absence on the day it happens, by note, email, or phone call. If the school is not notified, an automated system calls home by 1:00 p.m. and again in the evening. Lincoln uses the main office number for attendance.":
      "Un padre, madre o tutor debe reportar la falta el mismo día, por nota, correo electrónico o llamada. Si la escuela no recibe aviso, un sistema automático llama a casa antes de la 1:00 p. m. y otra vez en la noche. Lincoln usa el número de la oficina principal para las faltas.",
    "Call the Attendance Office before 8:00 a.m. each day of the absence. With a parent call the student goes straight to class the next day; after more than three days, or with no call, the student gets an absence slip from Student Services. Ten or more absences in a semester requires medical documentation.":
      "Llame a la Oficina de Asistencia antes de las 8:00 a. m. cada día de la falta. Con la llamada de un padre o madre, el estudiante va directo a clase al día siguiente; después de más de tres días, o si no hubo llamada, el estudiante recoge un comprobante de falta en Student Services. Diez faltas o más en un semestre requieren documentación médica.",
    "A parent or guardian should notify the Attendance Office before 10:00 a.m. each day the student is absent. Written notes should include the student's name, date, reason, and the parent's signature.":
      "Un padre, madre o tutor debe avisar a la Oficina de Asistencia antes de las 10:00 a. m. cada día que el estudiante falte. Las notas escritas deben incluir el nombre del estudiante, la fecha, el motivo y la firma del padre o madre.",
    "Call the Student Services Office before 8:00 a.m. each day the student is absent, or message a full-day absence through the Infinite Campus Parent Portal. Students need a note or parent call before returning to class, and 10 or more absences in a semester requires medical documentation.":
      "Llame a la oficina de Student Services antes de las 8:00 a. m. cada día que el estudiante falte, o avise una falta de día completo por el Portal para Padres de Infinite Campus. El estudiante necesita una nota o la llamada de un padre o madre antes de volver a clase, y 10 faltas o más en un semestre requieren documentación médica.",

    // Contacts
    "Main office": "Oficina principal",
    "Student services office (late arrival, leaving early, check-out)": "Oficina de Student Services (llegadas tarde, salidas temprano, firmar la salida)",
    "Attendance Office": "Oficina de Asistencia",
    "Principal": "Director(a)",
    "Assistant Principal": "Subdirector(a)",
    "Assistant Principal for Activities": "Subdirector(a) de Actividades",
    "Assistant Principal for Activities (clubs and activities questions)": "Subdirector(a) de Actividades (preguntas sobre clubes y actividades)",
    "Freshman Academy Coordinator (freshman tutoring)": "Coordinador(a) de la Academia de grado 9 (tutoría de grado 9)",
    "EL Tutoring contact": "Contacto de tutoría para estudiantes de inglés (EL)",
    "Counseling Office": "Oficina de Consejería",
    "Counselors available 7:30 a.m.-3:30 p.m. or by appointment; no counselor names or alphabet split listed.": "Consejeros disponibles de 7:30 a. m. a 3:30 p. m. o con cita; no se publican los nombres ni la división por apellido.",
    "Counselors available 7:30 a.m.-3:30 p.m. or by appointment; lockers and schedule change forms here. No counselor names listed.": "Consejeros disponibles de 7:30 a. m. a 3:30 p. m. o con cita; aquí se piden casilleros y formularios de cambio de horario. No se publican los nombres de los consejeros.",
    "Parking Lot Attendant (parking tags, bus passes)": "Encargado(a) del estacionamiento (permisos de estacionamiento, pases de autobús)",
    "Welcome Window by the Administration Office": "Ventanilla de bienvenida junto a la oficina de administración",
    "Welcome Window next to the administration office": "Ventanilla de bienvenida junto a la oficina de administración",
    "Student Services": "Student Services (servicios estudiantiles)",
    "Counselor (students A-C)": "Consejero(a) (estudiantes A-C)",
    "Counselor (students D-Hel)": "Consejero(a) (estudiantes D-Hel)",
    "Counselor (students Hem-Lo)": "Consejero(a) (estudiantes Hem-Lo)",
    "Counselor (students Lu-Pa)": "Consejero(a) (estudiantes Lu-Pa)",
    "Counselor (students Pe-Sti)": "Consejero(a) (estudiantes Pe-Sti)",
    "Counselor (students Sto-Z)": "Consejero(a) (estudiantes Sto-Z)",
    "School Nurse": "Enfermero(a) escolar",
    "Registrar": "Registro escolar",
    "Student Success Coordinator": "Coordinador(a) de éxito estudiantil",
    "School Social Worker": "Trabajador(a) social escolar",
    "EL Home/School Liaison": "Enlace entre casa y escuela para estudiantes de inglés (EL)",
    "Athletics (support team)": "Deportes (equipo de apoyo)",
    "Activities (support team)": "Actividades (equipo de apoyo)",
    "Principal's Clerical": "Asistente administrativo(a) de la dirección",
    "Main office / Student Services Office": "Oficina principal / oficina de Student Services",
    "In the Student Services Office; no name listed.": "En la oficina de Student Services; no se publica el nombre.",

    // Rules (titles)
    "Cell phones": "Teléfonos celulares",
    "Open lunch and leaving campus": "Almuerzo libre y salir de la escuela",
    "Tardies and sweeps": "Llegadas tarde y \"sweeps\"",
    "Make-up work": "Tareas de reposición",
    "Parking": "Estacionamiento",
    "Dress code": "Código de vestimenta",
    "Academic letters and grading": "Letras académicas y calificaciones",
    "Activity tickets": "Boletos de actividades",
    "Lockers": "Casilleros",
    "Visitors": "Visitantes",
    "Student ID": "Identificación estudiantil",
    "Activity eligibility": "Elegibilidad para actividades",
    "Athletic passes": "Pases deportivos",
    "Student ID and lockers": "Identificación estudiantil y casilleros",
    "Closed campus and leaving early": "Escuela cerrada y salidas temprano",
    "Late arrival and tardies": "Llegadas tarde",
    "Grades, honor roll and academic awards": "Calificaciones, cuadro de honor y premios académicos",
    "Visitors and deliveries": "Visitantes y entregas",
    "Lockers and student ID": "Casilleros e identificación estudiantil",

    // Rules (Lincoln)
    "Phones and earbuds are allowed before and after school, during passing time, and in the lunchroom during the student's lunch. They cannot be used during class or in the academic hallways during the school day; teachers set classroom rules and any staff member can send a phone to the office.":
      "Los teléfonos y audífonos se permiten antes y después de clases, entre clases y en el comedor durante el almuerzo del estudiante. No se pueden usar en clase ni en los pasillos académicos durante el día escolar; cada maestro pone las reglas de su salón y cualquier miembro del personal puede mandar un teléfono a la oficina.",
    "Lincoln is a closed campus. Juniors and seniors can have open lunch with a parent permission form, and lose it for unexcused absences, suspensions, or returning late. Anyone leaving during the day (illness, appointments) must check out in the office first and check back in on return; leaving without checking out can be unexcused.":
      "Lincoln es una escuela cerrada. Los de grados 11 y 12 pueden tener almuerzo libre con un formulario de permiso de los padres, y lo pierden por faltas injustificadas, suspensiones o regresar tarde. Quien salga durante el día (enfermedad, citas) debe firmar su salida en la oficina primero y registrarse al regresar; salir sin firmar puede contar como falta injustificada.",
    "Late students may be 'swept' to a holding location for the rest of the period; first-period sweeps count as skips. Students arriving within 15 minutes of first period get three free passes per quarter. First-period sweeps 1-3 get a warning, 4-8 get one after-school suspension each, and more than 8 in a quarter is treated as insubordination.":
      "Los estudiantes que llegan tarde pueden ser enviados (\"sweep\") a un lugar de espera por el resto del periodo; en el primer periodo cuenta como faltar a clase. Quienes llegan dentro de los primeros 15 minutos del primer periodo tienen tres pases gratis por trimestre. Del 1 al 3 \"sweeps\" del primer periodo reciben una advertencia, del 4 al 8 una suspensión después de clases cada uno, y más de 8 en un trimestre se trata como desobediencia.",
    "If asked, teachers can give up to five days of assignments before a planned absence; work for longer absences is available when the student returns. The teacher decides how much time is allowed. Students on school trips must still make up missed work.":
      "Si se les pide, los maestros pueden dar hasta cinco días de tareas antes de una falta planeada; para faltas más largas, el trabajo se entrega cuando el estudiante regresa. El maestro decide cuánto tiempo hay para entregarlo. Los estudiantes en viajes escolares también deben reponer el trabajo.",
    "Parking permits cost a fee (amount not listed) and are registered online; spaces are limited and not guaranteed. Health forms, the computer agreement, and any past fees must be cleared first. Cars without permits can be towed at the owner's expense.":
      "Los permisos de estacionamiento tienen un costo (no se publica el monto) y se registran en línea; los espacios son limitados y no están garantizados. Antes hay que tener al día los formularios de salud, el acuerdo de la computadora y cualquier cuota pendiente. Los carros sin permiso pueden ser remolcados por cuenta del dueño.",
    "Clothing must cover the body and undergarments and cannot show alcohol, tobacco, drugs, vulgarity, violence, or gang symbols. No hats, caps, beanies, or bandanas (hoods down), no slippers or pajama pants, blankets, hanging chains, spikes, or sunglasses; head wraps, bonnets, durags, and scarves are allowed. Violations may mean a call home for other clothes.":
      "La ropa debe cubrir el cuerpo y la ropa interior, y no puede mostrar alcohol, tabaco, drogas, vulgaridades, violencia ni símbolos de pandillas. No se permiten sombreros, gorras, gorros ni pañuelos (capuchas abajo), ni pantuflas o pantalones de pijama, cobijas, cadenas colgantes, picos ni lentes de sol; se permiten turbantes, gorros de satín, durags y bufandas. Si no se cumple, se puede llamar a casa para pedir otra ropa.",
    "Grades: A 90-100, B 80-89, C 70-79, D 60-69, F 59 and below. An academic letter requires a 3.5 GPA or higher in each of two consecutive semesters with at least a four-credit load. Incompletes must be cleared within two weeks of the grading period or become an F.":
      "Calificaciones: A 90-100, B 80-89, C 70-79, D 60-69, F 59 o menos. La letra académica requiere un promedio (GPA) de 3.5 o más en cada uno de dos semestres seguidos con al menos cuatro créditos. Las calificaciones incompletas deben resolverse dentro de las dos semanas posteriores al periodo de calificaciones o se convierten en F.",
    "Students can buy an activity ticket for reduced admission to regular-season athletic events (price not listed). It does not cover Presidents' Bowl, district, regional or state tournaments, or O'Gorman home games.":
      "Los estudiantes pueden comprar un boleto de actividades para entrar con descuento a los eventos deportivos de temporada regular (no se publica el precio). No incluye el Presidents' Bowl, los torneos de distrito, regionales o estatales, ni los partidos en casa de O'Gorman.",
    "Lockers are available on request from the counseling office. They are school property and can be searched on reasonable suspicion; the school is not responsible for stolen items.":
      "Los casilleros se piden en la oficina de consejería. Son propiedad de la escuela y pueden revisarse si hay sospecha razonable; la escuela no se hace responsable por objetos robados.",
    "Students who want to bring a visitor need administration approval at least one day ahead, and the visitor gets a pass at the office. Visits are limited to a half day and are not allowed the last two weeks of each semester or before holidays.":
      "Los estudiantes que quieran traer a un visitante necesitan la aprobación de la administración con al menos un día de anticipación, y el visitante recoge un pase en la oficina. Las visitas son de medio día como máximo y no se permiten las últimas dos semanas de cada semestre ni antes de días feriados.",
    "Students must carry their ID; it is needed to enter the building after the 8:19 warning bell, for lunch purchases, and the library. One replacement is free, then $5.":
      "Los estudiantes deben traer su identificación; la necesitan para entrar al edificio después del timbre de aviso de las 8:19, para comprar el almuerzo y para la biblioteca. El primer reemplazo es gratis y después cuesta $5.",
    "Teachers are available 7:30-8:15 a.m. and 3:15-4:00 p.m. Students not with a teacher or in an activity must leave by 3:25, and everyone should have a ride arranged by 4:30.":
      "Los maestros están disponibles de 7:30 a 8:15 a. m. y de 3:15 a 4:00 p. m. Los estudiantes que no estén con un maestro o en una actividad deben salir a más tardar a las 3:25, y todos deben tener transporte listo antes de las 4:30.",

    // Rules (Jefferson)
    "Phones may be used ONLY during the student's lunch. No phones, earbuds, or personal electronics during class or in the hallways at passing time; teachers can take a phone to the office and district discipline rules apply. Parents are asked not to text or call students during class.":
      "El teléfono se puede usar SOLO durante el almuerzo del estudiante. No se permiten teléfonos, audífonos ni aparatos electrónicos personales en clase ni en los pasillos entre clases; los maestros pueden llevar un teléfono a la oficina y se aplican las reglas de disciplina del distrito. Se pide a los padres no mandar mensajes ni llamar a los estudiantes durante las clases.",
    "Juniors and seniors on track by credits and in good standing can leave for the 65-minute lunch after a parent completes the Annual Student Information Update; it can be revoked for grades, attendance, behavior, or at a parent's request. All other students must stay in the building. To leave for an appointment, send a note or call before 8:10 a.m. that day and the student checks out and back in at Student Services.":
      "Los de grados 11 y 12 que van al día con sus créditos y tienen buena conducta pueden salir durante el almuerzo de 65 minutos después de que un padre o madre complete la Actualización Anual de Información del Estudiante; el permiso se puede quitar por calificaciones, asistencia, conducta o si los padres lo piden. Todos los demás deben quedarse en el edificio. Para salir a una cita, mande una nota o llame antes de las 8:10 a. m. ese día; el estudiante firma su salida y su regreso en Student Services.",
    "Students late to school or any class are 'swept' to the commons for the rest of the period, and a sweep counts as an absence. Each quarter students get 3 'freebies' to enter first period late if they reach Student Services within 10 minutes of the bell. A medical note or court summons is the only other exception.":
      "Los estudiantes que llegan tarde a la escuela o a cualquier clase son enviados (\"sweep\") al área común por el resto del periodo, y eso cuenta como falta. Cada trimestre tienen 3 pases gratis para entrar tarde al primer periodo si llegan a Student Services dentro de los 10 minutos después del timbre. La única otra excepción es una nota médica o un citatorio del tribunal.",
    "Students absent (not for a sweep or skip) get two times the number of days missed to make up work, up to 6 days.":
      "Los estudiantes que faltan (no por un \"sweep\" ni por saltarse clase) tienen el doble de los días que faltaron para reponer el trabajo, hasta 6 días.",
    "A student absent from school can't take part in activities that day or evening, and must be in school for the last three periods to practice or compete that day.":
      "Un estudiante que falta a la escuela no puede participar en actividades ese día ni esa noche, y debe estar en la escuela los últimos tres periodos para entrenar o competir ese día.",
    "Student parking is on the south, southwest, and west sides: $25 per semester or $50 per year, first come first served, $10 to replace a lost tag. Students without a tag can't park in the lot, and parking in staff areas can get a car towed.":
      "El estacionamiento estudiantil está en los lados sur, suroeste y oeste: $25 por semestre o $50 por año, según orden de llegada, y $10 para reemplazar un permiso perdido. Los estudiantes sin permiso no pueden estacionarse en el lote, y estacionarse en áreas del personal puede hacer que remolquen el carro.",
    "A pass is required to attend Sioux Falls School District events and is bought online through Bound (gobound.com/sd/schools/siouxfallsjefferson/stores). No price is listed.":
      "Se necesita un pase para asistir a los eventos del Distrito Escolar de Sioux Falls y se compra en línea en Bound (gobound.com/sd/schools/siouxfallsjefferson/stores). No se publica el precio.",
    "Clothing must cover the body and undergarments (no spaghetti straps, tube, halter, midriff, or backless tops) and can't show alcohol, drugs, vulgarity, violence, or gang symbols. No hats, caps, beanies, or bandanas (hoods down), slippers, pajama pants, blankets, hanging chains, spikes, or sunglasses; head wraps, bonnets, du-rags, and scarves are allowed. A parent may be called to bring other clothes.":
      "La ropa debe cubrir el cuerpo y la ropa interior (sin tirantes delgados, blusas strapless, halter, que muestren el abdomen o sin espalda) y no puede mostrar alcohol, drogas, vulgaridades, violencia ni símbolos de pandillas. No se permiten sombreros, gorras, gorros ni pañuelos (capuchas abajo), pantuflas, pantalones de pijama, cobijas, cadenas colgantes, picos ni lentes de sol; se permiten turbantes, gorros de satín, durags y bufandas. Se puede llamar a un padre o madre para que traiga otra ropa.",
    "Grades: A 90-100, B 80-89, C 70-79, D 60-69, F 59 and below; class rank is figured both weighted and unweighted. An academic letter requires at least a 3.5 GPA for two consecutive semesters.":
      "Calificaciones: A 90-100, B 80-89, C 70-79, D 60-69, F 59 o menos; el lugar en la clase se calcula con y sin ponderación. La letra académica requiere un promedio (GPA) de al menos 3.5 durante dos semestres seguidos.",
    "Students may not bring visitors to school. Parents check in at the Welcome Window with a picture ID.":
      "Los estudiantes no pueden traer visitantes a la escuela. Los padres se registran en la ventanilla de bienvenida con una identificación con foto.",
    "Students need their ID for lunch, the library, and dances; a replacement costs $5. Lockers are school property and can be searched on suspicion; don't share combinations.":
      "Los estudiantes necesitan su identificación para el almuerzo, la biblioteca y los bailes; un reemplazo cuesta $5. Los casilleros son propiedad de la escuela y pueden revisarse si hay sospecha; no compartan la combinación.",
    "Students must leave by 3:30 p.m. unless in a supervised activity; those waiting for rides wait in the commons, and rides should arrive before 4:30 p.m.":
      "Los estudiantes deben salir a más tardar a las 3:30 p. m., salvo que estén en una actividad supervisada; quienes esperan transporte esperan en el área común, y el transporte debe llegar antes de las 4:30 p. m.",

    // Rules (Roosevelt)
    "In class, phones must be in the student's backpack or the classroom phone caddy as the teacher directs, and there are no phones in hallways or restrooms during class or passing time. Consequences: 1st a reminder, 2nd phone goes in the caddy for the class, 3rd phone confiscated and the student must caddy it in all classes (detention), 4th a 90-minute detention and a plan.":
      "En clase, el teléfono debe estar en la mochila del estudiante o en el organizador de teléfonos del salón, según indique el maestro, y no se permiten teléfonos en pasillos ni baños durante clases o entre clases. Consecuencias: la 1.ª vez un recordatorio; la 2.ª el teléfono va al organizador durante la clase; la 3.ª se decomisa el teléfono y el estudiante debe dejarlo en el organizador en todas sus clases (detención); la 4.ª una detención de 90 minutos y un plan.",
    "Roosevelt is a closed campus. Students leaving for appointments must check out through Student Services and leave by the front administration entrance, then check back in on return. Students should be out of the building by 3:15 p.m. unless in a supervised activity.":
      "Roosevelt es una escuela cerrada. Los estudiantes que salen a una cita deben firmar su salida en Student Services y salir por la entrada principal de administración, y registrarse al regresar. Los estudiantes deben salir del edificio a más tardar a las 3:15 p. m., salvo que estén en una actividad supervisada.",
    "Students get three late-arrival exemptions per quarter; each tardy after that has a consequence (medical notes excepted), and after 15 minutes students are held out of first period. Exterior doors lock at 8:15, so late students use the main entrance. For periods 2-7, tardies lead to a 30-minute detention, then a 90-minute after-school detention, then administrative intervention.":
      "Los estudiantes tienen tres llegadas tarde sin consecuencia por trimestre; después, cada llegada tarde tiene consecuencia (salvo con nota médica), y después de 15 minutos no pueden entrar al primer periodo. Las puertas exteriores se cierran a las 8:15, así que quienes llegan tarde usan la entrada principal. En los periodos 2 a 7, las llegadas tarde llevan a una detención de 30 minutos, luego una de 90 minutos después de clases y luego a intervención de la administración.",
    "Students contact their teachers about missed work. District policy allows two days per day absent, up to six, for excused absences. For three or more days in a row, parents call to request assignments with one day's notice.":
      "Los estudiantes hablan con sus maestros sobre el trabajo atrasado. Según la política del distrito, hay dos días por cada día de falta justificada, hasta seis. Para tres días seguidos o más, los padres llaman para pedir las tareas con un día de anticipación.",
    "A student absent from school may not take part in school activities that day unless the principal approves. Participation also follows SDHSAA and district eligibility rules.":
      "Un estudiante que falta a la escuela no puede participar en actividades escolares ese día, salvo que el director lo apruebe. La participación también sigue las reglas de elegibilidad de la SDHSAA y del distrito.",
    "A Roosevelt parking permit is required: Main Lot $75, Kuehn Park $60. Cars without permits can be towed, and parking violations bring an automatic detention with no warning.":
      "Se necesita un permiso de estacionamiento de Roosevelt: lote principal $75, Kuehn Park $60. Los carros sin permiso pueden ser remolcados, y las infracciones de estacionamiento traen una detención automática sin advertencia.",
    "Students can buy an Activity Ticket for discounted entry to most regular-season Roosevelt athletic events (price not listed). It doesn't cover Presidents' Bowl, postseason tournaments, or O'Gorman home events.":
      "Los estudiantes pueden comprar un boleto de actividades para entrar con descuento a la mayoría de los eventos deportivos de temporada regular de Roosevelt (no se publica el precio). No incluye el Presidents' Bowl, los torneos de postemporada ni los eventos en casa de O'Gorman.",
    "Shirts must cover the midriff, chest, back, and sides, and clothing must not show undergarments. No hats, caps, beanies, or hoods during the day (they're held in Student Services until day's end); durags, bonnets, headbands, scarves, and headwraps are allowed. No slippers, blankets, flags, hanging chains, spikes, sunglasses, or clothing promoting drugs, alcohol, weapons, profanity, or gangs (including 'Playboy' and 'Cookies' brands).":
      "Las camisas deben cubrir el abdomen, el pecho, la espalda y los costados, y la ropa no debe mostrar la ropa interior. No se permiten sombreros, gorras, gorros ni capuchas durante el día (se guardan en Student Services hasta el final del día); se permiten durags, gorros de satín, diademas, bufandas y turbantes. No se permiten pantuflas, cobijas, banderas, cadenas colgantes, picos, lentes de sol ni ropa que promueva drogas, alcohol, armas, groserías o pandillas (incluidas las marcas 'Playboy' y 'Cookies').",
    "Standard A-F scale (A 90-100, B 80-89.9, C 70-79.9, D 60-69.9). Honor Roll: 4-credit load, 3.50+ GPA, no grade below a B; Merit Roll: 3.00-3.499. An Academic Award requires 3.50+ in each of two consecutive semesters with at least four credits.":
      "Escala estándar de A a F (A 90-100, B 80-89.9, C 70-79.9, D 60-69.9). Cuadro de honor: cuatro créditos, promedio (GPA) de 3.50 o más y ninguna calificación menor a B; Cuadro de mérito: 3.00 a 3.499. El premio académico requiere 3.50 o más en cada uno de dos semestres seguidos con al menos cuatro créditos.",
    "Visitors enter through the main entrance, check in at the office, and wear a badge; students may not bring guests. Food delivery services, balloons, flowers, and gifts for students are not accepted.":
      "Los visitantes entran por la entrada principal, se registran en la oficina y usan un gafete; los estudiantes no pueden traer invitados. No se aceptan entregas de comida, globos, flores ni regalos para estudiantes.",
    "Students get two ID cards; replacements are $5. Each student is assigned a locker; don't share it, and lockers may be inspected on reasonable suspicion.":
      "Cada estudiante recibe dos tarjetas de identificación; los reemplazos cuestan $5. A cada estudiante se le asigna un casillero; no debe compartirlo, y los casilleros pueden revisarse si hay sospecha razonable.",

    // Rules (Washington)
    "Phones and earbuds are allowed before and after school and during lunch. In class, phones must be off and stored, possibly in a phone holder or cabinet, and teachers can take a phone to the office. Smart watches, over-ear headphones, and speakers are not allowed during the school day.":
      "Los teléfonos y audífonos se permiten antes y después de clases y durante el almuerzo. En clase, el teléfono debe estar apagado y guardado, a veces en un organizador o gabinete, y los maestros pueden llevar un teléfono a la oficina. No se permiten relojes inteligentes, audífonos de diadema ni bocinas durante el día escolar.",
    "Only on-track juniors and seniors in good standing get open lunch; others must eat in the building. To leave for an appointment, send a note or call Student Services (605-367-7970) before 8:10 a.m. that day; students check out and back in at Student Services, and anyone arriving mid-day without medical documentation may wait in the commons until the next period.":
      "Solo los de grados 11 y 12 que van al día y tienen buena conducta tienen almuerzo libre; los demás deben comer en el edificio. Para salir a una cita, mande una nota o llame a Student Services (605-367-7970) antes de las 8:10 a. m. ese día; los estudiantes firman su salida y su regreso en Student Services, y quien llegue a mitad del día sin documentación médica puede tener que esperar en el área común hasta el siguiente periodo.",
    "Students get 6 'freebies' per semester, first period only, if they reach Student Services within 10 minutes of the bell. Otherwise late students are 'swept' to the commons for the period, which counts as an unexcused absence, with district discipline for repeat sweeps.":
      "Los estudiantes tienen 6 pases gratis por semestre, solo para el primer periodo, si llegan a Student Services dentro de los 10 minutos después del timbre. Si no, los que llegan tarde son enviados (\"sweep\") al área común por ese periodo, lo cual cuenta como falta injustificada, con disciplina del distrito si se repite.",
    "Students with excused absences get two times the number of days absent to make up work, up to 6 days.":
      "Los estudiantes con faltas justificadas tienen el doble de los días que faltaron para reponer el trabajo, hasta 6 días.",
    "Students absent from school can't take part in activities that day or evening and must be in school for the last three periods to practice or compete that day. District year-round activity rules also apply.":
      "Los estudiantes que faltan a la escuela no pueden participar en actividades ese día ni esa noche, y deben estar en la escuela los últimos tres periodos para entrenar o competir ese día. También se aplican las reglas de actividades del distrito para todo el año.",
    "An athletic pass is $20 and good at all four public high schools' events (a single student ticket is $6). It does not cover district, regional, or state tournaments, the Presidents Bowl, or O'Gorman home games. Buy through Bound: gobound.com/sd/districts/sfsd/stores/S115.":
      "El pase deportivo cuesta $20 y sirve para los eventos de las cuatro preparatorias públicas (un boleto individual de estudiante cuesta $6). No incluye torneos de distrito, regionales ni estatales, el Presidents Bowl ni los partidos en casa de O'Gorman. Se compra en Bound: gobound.com/sd/districts/sfsd/stores/S115.",
    "Student parking is $40 per semester or $75 for the year, first come first served, with a $10 replacement tag. Students without a tag can't park in the lot; parking in staff areas can get a car towed.":
      "El estacionamiento estudiantil cuesta $40 por semestre o $75 por el año, según orden de llegada, y $10 para reemplazar un permiso. Los estudiantes sin permiso no pueden estacionarse en el lote; estacionarse en áreas del personal puede hacer que remolquen el carro.",
    "Clothing must not inappropriately expose the body or undergarments or show alcohol, drugs, vulgarity, violence, or gang symbols. No hats, caps, beanies, or bandanas (hoods down), blankets, hanging chains, spikes, or sunglasses, and shoes are required; headbands, headwraps, bonnets, durags, and scarves are allowed. A parent may be called to bring other clothes.":
      "La ropa no debe mostrar de forma inapropiada el cuerpo o la ropa interior, ni alcohol, drogas, vulgaridades, violencia o símbolos de pandillas. No se permiten sombreros, gorras, gorros ni pañuelos (capuchas abajo), cobijas, cadenas colgantes, picos ni lentes de sol, y los zapatos son obligatorios; se permiten diademas, turbantes, gorros de satín, durags y bufandas. Se puede llamar a un padre o madre para que traiga otra ropa.",
    "Grades: A 90-100, B 80-89.9, C 70-79.9, D 60-69.9, F 59.9 and below, with both weighted and unweighted class rank. An academic letter requires at least a 3.5 GPA for two consecutive semesters.":
      "Calificaciones: A 90-100, B 80-89.9, C 70-79.9, D 60-69.9, F 59.9 o menos, con lugar en la clase con y sin ponderación. La letra académica requiere un promedio (GPA) de al menos 3.5 durante dos semestres seguidos.",
    "All visitors check in at the Welcome Window and have a photo ID scanned; walk-ins may not be seen right away. Students can't bring visitors to class.":
      "Todos los visitantes se registran en la ventanilla de bienvenida, donde se escanea una identificación con foto; quienes llegan sin cita quizás no sean atendidos de inmediato. Los estudiantes no pueden traer visitantes a clase.",
    "Lockers are assigned on request in the counseling office and can be searched on suspicion. Students need their ID for lunch, gym/library access at Warrior Halftime, and dances; a replacement is $5.":
      "Los casilleros se asignan a petición en la oficina de consejería y pueden revisarse si hay sospecha. Los estudiantes necesitan su identificación para el almuerzo, para entrar al gimnasio o la biblioteca en Warrior Halftime y para los bailes; un reemplazo cuesta $5.",
    "Students must leave by 3:20 p.m. unless in a supervised activity; those waiting for rides wait in the commons, and rides should arrive before 4:00 p.m.":
      "Los estudiantes deben salir a más tardar a las 3:20 p. m., salvo que estén en una actividad supervisada; quienes esperan transporte esperan en el área común, y el transporte debe llegar antes de las 4:00 p. m.",
  };
  Object.assign(es, {
    "Extra help and the library": "Ayuda extra y la biblioteca",
    "Freshman tutoring is Monday through Thursday, 3:00-3:30 p.m., for every 9th grader (questions: Dr. Todd Novak, Todd.Novak@k12.sd.us). EL tutoring is Thursdays 3:00-3:45 p.m. (Blake Dutton, blake.dutton@k12.sd.us). The library is open 7:00 a.m. to 4:30 p.m. daily; during class, students need a pass and their ID.":
      "La tutoría de grado 9 es de lunes a jueves, de 3:00 a 3:30 p. m., para todos los estudiantes de grado 9 (preguntas: Dr. Todd Novak, Todd.Novak@k12.sd.us). La tutoría para estudiantes de inglés (EL) es los jueves de 3:00 a 3:45 p. m. (Blake Dutton, blake.dutton@k12.sd.us). La biblioteca abre de 7:00 a. m. a 4:30 p. m. todos los días; en horas de clase, los estudiantes necesitan un pase y su identificación.",
    "Teachers and counselors are generally available 7:30-8:00 a.m. and 3:30-4:00 p.m. Saturday School runs 9:00 a.m. to noon on set dates through the year; ask the school. The library is open 7:00 a.m. to 4:30 p.m.":
      "Los maestros y consejeros suelen estar disponibles de 7:30 a 8:00 a. m. y de 3:30 a 4:00 p. m. La escuela de los sábados es de 9:00 a. m. al mediodía en fechas fijas durante el año; pregunte en la escuela. La biblioteca abre de 7:00 a. m. a 4:30 p. m.",
    "Freshman tutoring is Monday through Thursday, 3:15-3:45 p.m., for every 9th grader (questions: Wade Kippley, Wade.Kippley@k12.sd.us). The library is open 7:00 a.m. to 4:00 p.m. daily; during class, students need a pass and their ID.":
      "La tutoría de grado 9 es de lunes a jueves, de 3:15 a 3:45 p. m., para todos los estudiantes de grado 9 (preguntas: Wade Kippley, Wade.Kippley@k12.sd.us). La biblioteca abre de 7:00 a. m. a 4:00 p. m. todos los días; en horas de clase, los estudiantes necesitan un pase y su identificación.",
  });
  // Brandon Valley handbook strings.
  Object.assign(es, {
    "Supervision starts at 7:30, when breakfast is served.": "La supervisión empieza a las 7:30, cuando se sirve el desayuno.",
    "First bell": "Primer timbre",
    "Tardy bell": "Timbre de retardo",
    "Dismissal": "Salida",
    "No breakfast on a late start.": "No hay desayuno cuando la entrada se retrasa.",
    "Buses run their regular routes at the early time.": "Los autobuses hacen sus rutas normales a la hora adelantada.",
    "Lunch is $3.50 and breakfast $2.40; milk alone is $0.65. Breakfast is served from 7:30. Students eat in the school cafeteria.": "El almuerzo cuesta $3.50 y el desayuno $2.40; la leche sola, $0.65. El desayuno se sirve desde las 7:30. Los estudiantes comen en la cafetería de la escuela.",
    "Call the office by 8:30 AM when your child will be absent or late. If the school isn't told, the office calls home.": "Llame a la oficina antes de las 8:30 AM cuando su hijo vaya a faltar o llegar tarde. Si no se avisa a la escuela, la oficina llama a casa.",
    "Supervision starts at 7:45. Period times are on each team's page.": "La supervisión empieza a las 7:45. Los horarios de cada periodo están en la página de cada equipo.",
    "Classes start": "Inicio de clases",
    "Lunch is $3.50 and breakfast $2.40; milk alone is $0.65. Breakfast is served from 7:30.": "El almuerzo cuesta $3.50 y el desayuno $2.40; la leche sola, $0.65. El desayuno se sirve desde las 7:30.",
    "Call or email the office by 8:30 AM when your student will be absent.": "Llame o escriba a la oficina antes de las 8:30 AM cuando su estudiante vaya a faltar.",
    "Lunch falls in periods 4 to 6 by grade, each after a 13-minute homeroom. Periods 8 and 9 split by grade (7th grade class, 8th grade enrichment, then the reverse).": "El almuerzo cae en los periodos 4 a 6 según el grado, cada uno después de un homeroom de 13 minutos. Los periodos 8 y 9 se dividen por grado (clase de 7.º, enriquecimiento de 8.º, y luego al revés).",
    "Period 4": "Periodo 4",
    "Period 8": "Periodo 8",
    "Period 9": "Periodo 9",
    "No homeroom.": "Sin homeroom.",
    "Lunch is $3.75 and breakfast $2.40; milk alone is $0.65. The middle school has a closed noon hour: students stay on campus for lunch.": "El almuerzo cuesta $3.75 y el desayuno $2.40; la leche sola, $0.65. La middle school tiene hora de almuerzo cerrada: los estudiantes se quedan en la escuela para almorzar.",
    "Email the attendance office or call 605-582-3214 by 8:30 AM when your student will be absent.": "Escriba a la oficina de asistencia o llame al 605-582-3214 antes de las 8:30 AM cuando su estudiante vaya a faltar.",
    "Announcements and the pledge in period 3. TEAM time falls at 10:48, 11:42 and 1:06 on different days.": "Anuncios y juramento a la bandera en el periodo 3. El tiempo TEAM cae a las 10:48, 11:42 y 1:06 en distintos días.",
    "Zero period": "Periodo cero",
    "No zero period. Periods run 1, 2, 4, 5, 6, 3, 7, then periods 0 and 8 together from 2:38.": "Sin periodo cero. Los periodos van 1, 2, 4, 5, 6, 3, 7, y luego los periodos 0 y 8 juntos desde las 2:38.",
    "Periods 0 and 8": "Periodos 0 y 8",
    "Periods run 1, 2, 3, 7, 4, 5, 6, 8.": "Los periodos van 1, 2, 3, 7, 4, 5, 6, 8.",
    "Lunch is $3.85 and breakfast $2.40; milk alone is $0.65. The high school has a closed noon hour: students stay on campus for lunch.": "El almuerzo cuesta $3.85 y el desayuno $2.40; la leche sola, $0.65. La preparatoria tiene hora de almuerzo cerrada: los estudiantes se quedan en la escuela para almorzar.",
    "A parent calls the office by 9:00 AM on the day of the absence; after that the office calls home, and an unreported absence is unexcused. Medical and counseling notes are due within one week of the appointment.": "Un padre o madre llama a la oficina antes de las 9:00 AM el día de la ausencia; después la oficina llama a casa, y una ausencia no reportada es injustificada. Las notas médicas y de consejería se entregan dentro de la semana siguiente a la cita.",
    "Building hours": "Horario del edificio",
    "Regular building hours are 7:30 AM to 3:45 PM; doors lock at 4:45 PM. Visitors use the west office doors between 8:05 AM and 3:20 PM.": "El horario normal del edificio es de 7:30 AM a 3:45 PM; las puertas se cierran con llave a las 4:45 PM. Las visitas usan las puertas de la oficina oeste entre las 8:05 AM y las 3:20 PM.",
    "Call the office by 9:00 AM on the day of the absence. Planned absences (family trips, school events) have work completed beforehand unless the teacher says otherwise. Medical notes are due within a week.": "Llame a la oficina antes de las 9:00 AM el día de la ausencia. En las ausencias planeadas (viajes familiares, eventos escolares) el trabajo se entrega antes, salvo que el maestro indique otra cosa. Las notas médicas se entregan dentro de una semana.",
    "A two-hour late start runs 10:05 to 3:14 with no zero period. An early release ends at 1:14.": "Una entrada retrasada dos horas va de 10:05 a 3:14 sin periodo cero. Una salida adelantada termina a la 1:14.",
    "Graduation and honors": "Graduación y honores",
    "To take part in graduation a student has met all state and district requirements, attended practice and paid all fines and fees. Seniors with a GPA of 3.70 or higher are honor graduates.": "Para participar en la graduación, el estudiante debe haber cumplido todos los requisitos estatales y del distrito, asistido al ensayo y pagado todas las multas y cuotas. Los estudiantes de último año con promedio de 3.70 o más se gradúan con honores.",
    "A physical on file before the first practice. The Activities handbook covers eligibility, conduct and the activity pass.": "Un examen físico archivado antes de la primera práctica. El manual de actividades cubre la elegibilidad, la conducta y el pase de actividades.",
  });
  Object.assign(self.SFI18N.es, es);
})();
